<?php

namespace App\Services\Radius;

use RuntimeException;

/**
 * Sends RFC 5176 Disconnect-Request and CoA-Request packets over UDP and
 * validates the NAS's reply. Nothing in this codebase speaks RADIUS wire
 * protocol yet — everything else works through FreeRADIUS reading MySQL — so
 * this builds and signs packets by hand rather than pulling in a client
 * library.
 *
 * Two very different operations share the machinery here: disconnect() is an
 * instruction and tears a session down, probe() is a question and changes
 * nothing. Keep that distinction in mind before reusing either.
 */
class CoaClient
{
    private const CODE_DISCONNECT_REQUEST = 40;
    private const CODE_DISCONNECT_ACK = 41;
    private const CODE_DISCONNECT_NAK = 42;
    private const CODE_COA_REQUEST = 43;
    private const CODE_COA_ACK = 44;
    private const CODE_COA_NAK = 45;

    /** RFC 5176 §3.5. 503 is the only cause that proves the session is gone. */
    private const ERROR_SESSION_CONTEXT_NOT_FOUND = 503;

    /** Session exists on the NAS right now. */
    public const PROBE_ALIVE = 'alive';

    /** NAS answered, and answered that it has never heard of this session. */
    public const PROBE_NOT_FOUND = 'not_found';

    /**
     * NAS answered NAK, but for a reason that does not by itself prove absence.
     * RouterOS answers a no-op CoA-Request for a session it does not have with
     * Error-Cause 406 (Unsupported-Extension) rather than the standard 503, so
     * on its own this is ambiguous: it could equally mean the NAS does not
     * support being probed at all. The caller must corroborate it against an
     * ACK from the same NAS before treating it as proof.
     */
    public const PROBE_REJECTED = 'rejected';

    /** No usable answer — unreachable, malformed, or no reply at all. */
    public const PROBE_UNKNOWN = 'unknown';

    private const ATTR_USER_NAME = 1;
    private const ATTR_FRAMED_IP_ADDRESS = 8;
    private const ATTR_ACCT_SESSION_ID = 44;
    private const ATTR_MESSAGE_AUTHENTICATOR = 80;
    private const ATTR_ERROR_CAUSE = 101;

    public function __construct(
        private readonly int $port = 3799,
        private readonly float $timeoutSeconds = 3.0,
        private readonly int $retries = 2,
    ) {
    }

    /**
     * @param array{username: string, acctSessionId?: ?string, framedIp?: ?string} $session
     * @param ?int $port  the NAS's CoA listener port; falls back to the default 3799
     *
     * @throws RuntimeException if the NAS is unreachable, the reply fails
     *                          authentication, or it responds with a NAK
     */
    public function disconnect(string $nasHost, string $secret, array $session, ?int $port = null): void
    {
        $identifier = random_int(0, 255);
        $packet = $this->buildSignedPacket(self::CODE_DISCONNECT_REQUEST, $identifier, $this->buildAttributes($session), $secret);

        $response = $this->sendWithRetries($nasHost, $packet, $port ?? $this->port);
        $this->verifyResponseAuthenticator($response, $packet, $secret);

        $code = ord($response[0]);

        if ($code === self::CODE_DISCONNECT_NAK) {
            throw new RuntimeException("NAS {$nasHost} rejected disconnect for '{$session['username']}' (Disconnect-NAK)");
        }

        if ($code !== self::CODE_DISCONNECT_ACK) {
            throw new RuntimeException("NAS {$nasHost} returned unexpected CoA response code {$code}");
        }
    }

    /**
     * Ask the NAS whether a session still exists, changing nothing.
     *
     * A CoA-Request carrying only identification attributes is a question, not
     * an instruction: the NAS answers CoA-ACK if it can find the session and
     * CoA-NAK if it cannot. That distinction is the whole point — it is the only
     * signal available that separates a session the NAS abandoned without an
     * Accounting-Stop from one that is alive but simply has not sent an interim
     * update yet. Both look identical in radacct (open, zero octets, no update),
     * and guessing between them from the table alone is how you disconnect a
     * customer mid-download.
     *
     * Deliberately NOT a Disconnect-Request: that one is destructive, and a
     * wrong guess would kill a live session rather than merely mis-read it.
     *
     * Error-Cause 503 (Session-Context-Not-Found) is unambiguous proof of
     * absence and returns PROBE_NOT_FOUND on its own. Any other NAK returns
     * PROBE_REJECTED, which means "the NAS declined, and we cannot tell from
     * this packet alone whether that is about the session or about the
     * request" — measured against RouterOS, a missing session comes back as
     * Error-Cause 406, indistinguishable in isolation from a NAS that does not
     * support probing. Resolving that is the caller's job.
     *
     * @param array{username: string, acctSessionId?: ?string, framedIp?: ?string} $session
     *
     * @return self::PROBE_* never throws; an unreachable NAS is a PROBE_UNKNOWN
     */
    public function probe(string $nasHost, string $secret, array $session, ?int $port = null): string
    {
        $identifier = random_int(0, 255);
        $packet = $this->buildSignedPacket(
            self::CODE_COA_REQUEST,
            $identifier,
            $this->buildAttributes($session),
            $secret,
        );

        try {
            $response = $this->sendWithRetries($nasHost, $packet, $port ?? $this->port);
            $this->verifyResponseAuthenticator($response, $packet, $secret);
        } catch (RuntimeException) {
            return self::PROBE_UNKNOWN;
        }

        return match (ord($response[0])) {
            self::CODE_COA_ACK => self::PROBE_ALIVE,
            self::CODE_COA_NAK => $this->parseErrorCause($response) === self::ERROR_SESSION_CONTEXT_NOT_FOUND
                ? self::PROBE_NOT_FOUND
                : self::PROBE_REJECTED,
            default => self::PROBE_UNKNOWN,
        };
    }

    /** Error-Cause (RFC 5176 §3.5) out of a response's attribute list, if present. */
    private function parseErrorCause(string $response): ?int
    {
        $declared = (int) unpack('n', substr($response, 2, 2))[1];
        $length = min(strlen($response), $declared);
        $offset = 20;

        while ($offset + 2 <= $length) {
            $type = ord($response[$offset]);
            $attributeLength = ord($response[$offset + 1]);

            // A zero/short length would loop forever; a run past the end means
            // the packet lied about its own size. Either way, stop trusting it.
            if ($attributeLength < 2 || $offset + $attributeLength > $length) {
                return null;
            }

            if ($type === self::ATTR_ERROR_CAUSE && $attributeLength === 6) {
                return (int) unpack('N', substr($response, $offset + 2, 4))[1];
            }

            $offset += $attributeLength;
        }

        return null;
    }

    private function buildAttributes(array $session): string
    {
        $attributes = $this->encodeAttr(self::ATTR_USER_NAME, $session['username']);

        // Acct-Session-Id pins down the exact session; without it a NAS falls
        // back to matching on User-Name (+ Framed-IP-Address if given), which
        // is enough but disconnects every session for that user.
        if (!empty($session['acctSessionId'])) {
            $attributes .= $this->encodeAttr(self::ATTR_ACCT_SESSION_ID, $session['acctSessionId']);
        }

        if (!empty($session['framedIp'])) {
            $attributes .= $this->encodeAttr(self::ATTR_FRAMED_IP_ADDRESS, inet_pton($session['framedIp']));
        }

        return $attributes;
    }

    private function encodeAttr(int $type, string $value): string
    {
        $length = 2 + strlen($value);
        if ($length > 255) {
            throw new RuntimeException("RADIUS attribute {$type} value too long ({$length} bytes)");
        }

        return chr($type).chr($length).$value;
    }

    /**
     * Signs per RFC 5176 §3: Message-Authenticator is computed with the
     * Request Authenticator zeroed, then the real Request Authenticator is
     * computed (RFC 2866-style) over the packet that now carries it.
     */
    private function buildSignedPacket(int $code, int $identifier, string $attributes, string $secret): string
    {
        $messageAuthPlaceholder = $this->encodeAttr(self::ATTR_MESSAGE_AUTHENTICATOR, str_repeat("\x00", 16));
        $attributesWithPlaceholder = $attributes.$messageAuthPlaceholder;
        $length = 20 + strlen($attributesWithPlaceholder);
        $zeroAuthenticator = str_repeat("\x00", 16);

        $header = chr($code).chr($identifier).pack('n', $length).$zeroAuthenticator;
        $messageAuthenticator = hash_hmac('md5', $header.$attributesWithPlaceholder, $secret, true);

        $signedAttributes = $attributes.$this->encodeAttr(self::ATTR_MESSAGE_AUTHENTICATOR, $messageAuthenticator);
        $requestAuthenticator = md5($header.$signedAttributes.$secret, true);

        return chr($code).chr($identifier).pack('n', $length).$requestAuthenticator.$signedAttributes;
    }

    private function sendWithRetries(string $host, string $packet, int $port): string
    {
        $socket = @stream_socket_client("udp://{$host}:{$port}", $errno, $errstr, $this->timeoutSeconds);

        if ($socket === false) {
            throw new RuntimeException("Unable to open UDP socket to {$host}:{$port}: {$errstr}");
        }

        stream_set_timeout($socket, (int) ceil($this->timeoutSeconds));

        try {
            for ($attempt = 1; $attempt <= $this->retries + 1; $attempt++) {
                fwrite($socket, $packet);
                $response = fread($socket, 4096);
                $timedOut = stream_get_meta_data($socket)['timed_out'];

                if ($response !== false && $response !== '' && !$timedOut) {
                    return $response;
                }
            }
        } finally {
            fclose($socket);
        }

        throw new RuntimeException(
            "No CoA response from {$host}:{$port} after {$this->retries} retries — "
            . 'check that the router accepts incoming RADIUS (MikroTik: /radius incoming set accept=yes) '
            . 'and that the port is reachable from this server.'
        );
    }

    private function verifyResponseAuthenticator(string $response, string $requestPacket, string $secret): void
    {
        if (strlen($response) < 20) {
            throw new RuntimeException('Malformed CoA response (shorter than a RADIUS header)');
        }

        $requestAuthenticator = substr($requestPacket, 4, 16);
        $expected = md5(substr($response, 0, 4).$requestAuthenticator.substr($response, 20).$secret, true);
        $actual = substr($response, 4, 16);

        if (!hash_equals($expected, $actual)) {
            throw new RuntimeException('CoA response authenticator mismatch — wrong secret or spoofed reply');
        }
    }
}
