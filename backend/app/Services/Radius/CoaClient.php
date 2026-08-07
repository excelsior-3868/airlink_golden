<?php

namespace App\Services\Radius;

use RuntimeException;

/**
 * Sends RFC 5176 Disconnect-Request packets over UDP and validates the
 * NAS's reply. Nothing in this codebase speaks RADIUS wire protocol yet —
 * everything else works through FreeRADIUS reading MySQL — so this builds
 * and signs packets by hand rather than pulling in a client library.
 */
class CoaClient
{
    private const CODE_DISCONNECT_REQUEST = 40;
    private const CODE_DISCONNECT_ACK = 41;
    private const CODE_DISCONNECT_NAK = 42;

    private const ATTR_USER_NAME = 1;
    private const ATTR_FRAMED_IP_ADDRESS = 8;
    private const ATTR_ACCT_SESSION_ID = 44;
    private const ATTR_MESSAGE_AUTHENTICATOR = 80;

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
