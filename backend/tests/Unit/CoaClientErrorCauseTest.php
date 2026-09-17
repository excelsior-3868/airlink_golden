<?php

namespace Tests\Unit;

use App\Services\Radius\CoaClient;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/**
 * Error-Cause parsing decides whether a radacct row gets closed, and it runs on
 * bytes from the network. A malformed packet must never loop forever or read
 * past the buffer — it must simply decline to answer.
 */
class CoaClientErrorCauseTest extends TestCase
{
    private function parse(string $attributes, ?int $declaredLength = null): ?int
    {
        $length = $declaredLength ?? (20 + strlen($attributes));
        $packet = chr(45).chr(7).pack('n', $length).str_repeat("\x00", 16).$attributes;

        $method = new ReflectionMethod(CoaClient::class, 'parseErrorCause');

        return $method->invoke(new CoaClient(), $packet);
    }

    /** Error-Cause (101), length 6, 4-byte integer value. */
    private function errorCause(int $value): string
    {
        return chr(101).chr(6).pack('N', $value);
    }

    private function filler(int $type = 1, string $value = 'user'): string
    {
        return chr($type).chr(2 + strlen($value)).$value;
    }

    public function test_reads_session_context_not_found(): void
    {
        $this->assertSame(503, $this->parse($this->errorCause(503)));
    }

    public function test_reads_error_cause_after_other_attributes(): void
    {
        $this->assertSame(503, $this->parse($this->filler().$this->errorCause(503)));
    }

    public function test_distinguishes_other_causes(): void
    {
        // 401 Unsupported-Attribute is about our packet, not the session, so the
        // caller must be able to tell it apart from 503 and leave the row alone.
        $this->assertSame(401, $this->parse($this->errorCause(401)));
    }

    public function test_returns_null_when_absent(): void
    {
        $this->assertNull($this->parse($this->filler()));
    }

    public function test_returns_null_on_zero_length_attribute_instead_of_looping(): void
    {
        $this->assertNull($this->parse(chr(101).chr(0).'garbage'));
    }

    public function test_returns_null_when_an_attribute_overruns_the_packet(): void
    {
        // Declares 40 bytes of value with only a few present.
        $this->assertNull($this->parse(chr(101).chr(40).'short'));
    }

    public function test_ignores_bytes_beyond_the_declared_length(): void
    {
        // A truthful header must win over trailing padding: the Error-Cause here
        // sits outside the declared length and must not be read.
        $this->assertNull($this->parse($this->errorCause(503), 20));
    }

    public function test_handles_declared_length_longer_than_the_buffer(): void
    {
        $this->assertSame(503, $this->parse($this->errorCause(503), 9999));
    }

    public function test_returns_null_on_wrong_sized_error_cause(): void
    {
        $this->assertNull($this->parse(chr(101).chr(4).'ab'));
    }
}
