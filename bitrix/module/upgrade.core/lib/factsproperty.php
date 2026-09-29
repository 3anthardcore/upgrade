<?php
declare(strict_types=1);

namespace Upgrade\Core;

/** Internal storage codec only. Managed facts and their hashes remain raw JSON. */
final class FactsProperty
{
    public const MAX_STORED_BYTES = 60000;
    public const LEGACY_MAX_BYTES = 65535;
    public const MAX_RAW_BYTES = 16777216;
    private const PREFIX = 'UPGRADE_FACTS:';

    public static function encode(string $raw): string
    {
        self::validateRaw($raw);
        if (strlen($raw) <= self::MAX_STORED_BYTES) {
            return $raw;
        }
        $compressed = gzencode($raw, 9, ZLIB_ENCODING_GZIP);
        if ($compressed === false) {
            throw new \RuntimeException('UG_FACTS compression failed');
        }
        $stored = self::PREFIX . json_encode([
            'version' => 1,
            'encoding' => 'gzip+base64',
            'raw_bytes' => strlen($raw),
            'raw_sha256' => hash('sha256', $raw),
            'data' => base64_encode($compressed),
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (strlen($stored) > self::MAX_STORED_BYTES) {
            throw new \RuntimeException('UG_FACTS encoded storage limit exceeded');
        }
        return $stored;
    }

    public static function decode(string $stored): string
    {
        if (!str_starts_with($stored, self::PREFIX)) {
            if (strlen($stored) > self::LEGACY_MAX_BYTES) {
                throw new \RuntimeException('UG_FACTS legacy stored size limit exceeded');
            }
            self::validateRaw($stored);
            return $stored;
        }
        if (strlen($stored) > self::MAX_STORED_BYTES) {
            throw new \RuntimeException('UG_FACTS stored size limit exceeded');
        }
        $json = substr($stored, strlen(self::PREFIX));
        try {
            $envelope = json_decode($json, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw new \RuntimeException('UG_FACTS envelope JSON invalid', 0, $error);
        }
        if (!is_array($envelope)
            || array_keys($envelope) !== ['version', 'encoding', 'raw_bytes', 'raw_sha256', 'data']
            || $envelope['version'] !== 1
            || $envelope['encoding'] !== 'gzip+base64'
            || !is_int($envelope['raw_bytes'])
            || $envelope['raw_bytes'] <= self::MAX_STORED_BYTES
            || $envelope['raw_bytes'] > self::MAX_RAW_BYTES
            || !is_string($envelope['raw_sha256'])
            || !preg_match('/\A[a-f0-9]{64}\z/D', $envelope['raw_sha256'])
            || !is_string($envelope['data'])
            || $json !== json_encode($envelope, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)) {
            throw new \RuntimeException('UG_FACTS envelope contract invalid');
        }
        $compressed = base64_decode($envelope['data'], true);
        if ($compressed === false || base64_encode($compressed) !== $envelope['data']) {
            throw new \RuntimeException('UG_FACTS base64 invalid');
        }
        // Never expand an untrusted envelope without a bounded output length.
        $raw = @gzdecode($compressed, $envelope['raw_bytes'] + 1);
        if ($raw === false
            || strlen($raw) !== $envelope['raw_bytes']
            || !hash_equals($envelope['raw_sha256'], hash('sha256', $raw))) {
            throw new \RuntimeException('UG_FACTS compressed content integrity failure');
        }
        self::validateRaw($raw);
        return $raw;
    }

    private static function validateRaw(string $raw): void
    {
        if ($raw === '' || strlen($raw) > self::MAX_RAW_BYTES) {
            throw new \RuntimeException('UG_FACTS raw size limit exceeded');
        }
        try {
            json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw new \RuntimeException('UG_FACTS raw JSON invalid', 0, $error);
        }
    }
}
