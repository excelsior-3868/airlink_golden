<?php

namespace App\Services;

use App\Models\Voucher;
use App\Models\VoucherCardTemplate;

/**
 * Renders a printable prepaid WiFi voucher card as a PNG, driven by the
 * admin-configurable VoucherCardTemplate (background image + positioned text
 * elements). Positions are percentages of the card; font sizes are design
 * pixels relative to the template width.
 */
class VoucherCardService
{
    // Supersample factor for crisp print output.
    private const SCALE = 2;

    public function png(Voucher $voucher): string
    {
        $tpl = VoucherCardTemplate::active();
        $designW = max(1, (int) $tpl->width);
        $designH = max(1, (int) $tpl->height);
        $W = $designW * self::SCALE;
        $H = $designH * self::SCALE;

        $card = $this->background($tpl, $W, $H);
        imagealphablending($card, true);
        imagesavealpha($card, true);

        $font = base_path('vendor/endroid/qr-code/assets/open_sans.ttf');

        foreach (($tpl->elements ?? []) as $el) {
            if (($el['field'] ?? 'text') === 'image') {
                $this->drawImage($card, $el, $W, $H);
                continue;
            }
            $text = $this->resolve($el, $voucher);
            if ($text === '') {
                continue;
            }
            $this->drawElement($card, $el, $text, $W, $H, $designW, $font);
        }

        ob_start();
        imagepng($card);
        $out = ob_get_clean();
        imagedestroy($card);

        return $out;
    }

    /** Build the card canvas from the template background (data URI, shipped asset, or solid). */
    private function background(VoucherCardTemplate $tpl, int $W, int $H)
    {
        $raw = null;
        if ($tpl->background_data && str_contains($tpl->background_data, 'base64,')) {
            $raw = base64_decode(substr($tpl->background_data, strpos($tpl->background_data, 'base64,') + 7)) ?: null;
        } elseif (file_exists($p = public_path('voucher-card-bg.png'))) {
            $raw = file_get_contents($p) ?: null;
        }

        $card = imagecreatetruecolor($W, $H);
        if ($raw && ($bg = @imagecreatefromstring($raw))) {
            imagecopyresampled($card, $bg, 0, 0, 0, 0, $W, $H, imagesx($bg), imagesy($bg));
            imagedestroy($bg);
        } else {
            imagefill($card, 0, 0, imagecolorallocate($card, 197, 220, 232));
        }

        return $card;
    }

    /** Composite a logo/image element onto the card, preserving transparency. */
    private function drawImage($card, array $el, int $W, int $H): void
    {
        $uri = $el['image_data'] ?? '';
        if (! $uri || ! str_contains($uri, 'base64,')) {
            return;
        }
        $raw = base64_decode(substr($uri, strpos($uri, 'base64,') + 7)) ?: null;
        if (! $raw || ! ($img = @imagecreatefromstring($raw))) {
            return;
        }

        $srcW = imagesx($img);
        $srcH = imagesy($img);
        $dstW = (int) round(((float) ($el['width'] ?? 20)) / 100 * $W);
        $dstH = $srcW > 0 ? (int) round($dstW * $srcH / $srcW) : 0;
        if ($dstW < 1 || $dstH < 1) {
            imagedestroy($img);
            return;
        }

        $anchorX = $el['x'] / 100 * $W;
        $x = match ($el['align'] ?? 'left') {
            'right' => $anchorX - $dstW,
            'center' => $anchorX - $dstW / 2,
            default => $anchorX,
        };
        $y = $el['y'] / 100 * $H;

        imagealphablending($card, true);
        imagecopyresampled($card, $img, (int) round($x), (int) round($y), 0, 0, $dstW, $dstH, $srcW, $srcH);
        imagedestroy($img);
    }

    /** Resolve an element's dynamic value from the voucher. */
    private function resolve(array $el, Voucher $voucher): string
    {
        return match ($el['field'] ?? 'text') {
            'price' => $voucher->price ? 'Rs. ' . number_format((float) $voucher->price, 0) : '',
            'code' => (string) $voucher->code,
            'serial_number' => (string) $voucher->serial_number,
            'plan_name' => (string) ($voucher->plan?->name ?? ''),
            'username' => (string) $voucher->username,
            'password' => (string) $voucher->password,
            default => (string) ($el['text'] ?? ''),
        };
    }

    private function drawElement($card, array $el, string $text, int $W, int $H, int $designW, string $font): void
    {
        $scale = $W / $designW;
        // Design px → GD points (~0.75) then supersampled.
        $ptSize = max(1, (float) $el['font_size'] * $scale * 0.75);
        $spacing = (float) ($el['letter_spacing'] ?? 0) * $scale;

        [$r, $g, $b] = $this->hex($el['color'] ?? '#ffffff');
        $color = imagecolorallocate($card, $r, $g, $b);
        $bold = (int) ($el['weight'] ?? 400) >= 700;

        $textW = $this->measure($ptSize, $font, $text, $spacing);
        $anchorX = $el['x'] / 100 * $W;
        $x = match ($el['align'] ?? 'left') {
            'right' => $anchorX - $textW,
            'center' => $anchorX - $textW / 2,
            default => $anchorX,
        };
        // (x,y) anchors the text's top-left; convert to GD baseline.
        $y = $el['y'] / 100 * $H + $ptSize;

        // Drop shadow for light text over imagery.
        if (! empty($el['shadow'])) {
            $shadow = imagecolorallocatealpha($card, 0, 0, 0, 40);
            $off = max(1, (int) round($scale));
            $this->writeText($card, $ptSize, (int) round($x + $off), (int) round($y + $off), $shadow, $font, $text, $spacing, $bold);
        }

        $this->writeText($card, $ptSize, (int) round($x), (int) round($y), $color, $font, $text, $spacing, $bold);

        if (! empty($el['underline'])) {
            $uy = (int) round($y + $ptSize * 0.28);
            imagesetthickness($card, max(1, (int) round($scale)));
            imageline($card, (int) round($x), $uy, (int) round($x + $textW), $uy, $color);
            imagesetthickness($card, 1);
        }
    }

    /** Draw text char-by-char to honor letter spacing; overdraw once for bold. */
    private function writeText($card, float $size, int $x, int $y, int $color, string $font, string $text, float $spacing, bool $bold): void
    {
        $draw = function (int $ox) use ($card, $size, $x, $y, $color, $font, $text, $spacing) {
            if (! file_exists($font)) {
                imagestring($card, 5, $x + $ox, $y - (int) $size, $text, $color);
                return;
            }
            if ($spacing <= 0) {
                imagettftext($card, $size, 0, $x + $ox, $y, $color, $font, $text);
                return;
            }
            $cx = $x + $ox;
            foreach (mb_str_split($text) as $ch) {
                imagettftext($card, $size, 0, $cx, $y, $color, $font, $ch);
                $box = imagettfbbox($size, 0, $font, $ch);
                $cx += abs($box[2] - $box[0]) + $spacing;
            }
        };
        $draw(0);
        if ($bold) {
            $draw(1); // faux-bold
        }
    }

    /** Pixel width of a string including letter spacing. */
    private function measure(float $size, string $font, string $text, float $spacing): float
    {
        if (! file_exists($font)) {
            return imagefontwidth(5) * mb_strlen($text);
        }
        if ($spacing <= 0) {
            $box = imagettfbbox($size, 0, $font, $text);
            return abs($box[2] - $box[0]);
        }
        $w = 0;
        foreach (mb_str_split($text) as $ch) {
            $box = imagettfbbox($size, 0, $font, $ch);
            $w += abs($box[2] - $box[0]) + $spacing;
        }
        return max(0, $w - $spacing);
    }

    /** '#rrggbb' → [r,g,b]. */
    private function hex(string $hex): array
    {
        $hex = ltrim($hex, '#');
        if (strlen($hex) === 3) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        return [
            hexdec(substr($hex, 0, 2) ?: '0'),
            hexdec(substr($hex, 2, 2) ?: '0'),
            hexdec(substr($hex, 4, 2) ?: '0'),
        ];
    }
}
