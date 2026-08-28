package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math/rand/v2"
	"testing"
)

func encodePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 200, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

// Шум не сжимается, поэтому PNG получается тяжелее лимита — как настоящий
// скриншот с retina-экрана.
func encodeNoisyPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	rnd := rand.New(rand.NewPCG(1, 2))
	buf := make([]byte, 4)
	for y := range h {
		for x := range w {
			binary.LittleEndian.PutUint32(buf, rnd.Uint32())
			img.Set(x, y, color.RGBA{R: buf[0], G: buf[1], B: buf[2], A: 255})
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return out.Bytes()
}

func TestShrinkForAPIDownscalesHeavyImage(t *testing.T) {
	in := encodeNoisyPNG(t, 3200, 2000)
	if len(in) <= maxImageBytes {
		t.Fatalf("тестовая картинка %d байт — нужна тяжелее %d", len(in), maxImageBytes)
	}
	out, mt := shrinkForAPI(in, "image/png")

	if mt != "image/jpeg" {
		t.Errorf("mediaType = %q, want image/jpeg", mt)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("DecodeConfig: %v", err)
	}
	if cfg.Width != maxImageDimension {
		t.Errorf("ширина = %d, want %d", cfg.Width, maxImageDimension)
	}
	if cfg.Height != 2000*maxImageDimension/3200 {
		t.Errorf("высота = %d, пропорции не сохранены", cfg.Height)
	}
	if len(out) > maxImageBytes {
		t.Errorf("после сжатия %d байт, лимит %d", len(out), maxImageBytes)
	}
}

// Хорошо сжимаемый PNG после пережатия в JPEG может стать толще — в этом
// случае оригинал должен уехать как есть.
func TestShrinkForAPIKeepsOriginalWhenJPEGIsBigger(t *testing.T) {
	in := encodePNG(t, 3200, 2000)
	if len(in) > maxImageBytes {
		t.Fatalf("градиент неожиданно тяжёлый: %d байт", len(in))
	}
	out, mt := shrinkForAPI(in, "image/png")

	if mt != "image/png" || !bytes.Equal(out, in) {
		t.Errorf("оригинал должен был остаться: mediaType=%q, размер %d → %d", mt, len(in), len(out))
	}
}

func TestShrinkForAPILeavesSmallImageAlone(t *testing.T) {
	in := encodePNG(t, 800, 600)
	out, mt := shrinkForAPI(in, "image/png")

	if mt != "image/png" || !bytes.Equal(out, in) {
		t.Errorf("маленькая картинка не должна пережиматься: mediaType=%q, изменено=%v", mt, !bytes.Equal(out, in))
	}
}

func TestShrinkForAPIPassesUndecodableThrough(t *testing.T) {
	in := []byte("RIFF____WEBPнеразбираемое")
	out, mt := shrinkForAPI(in, "image/webp")

	if mt != "image/webp" || !bytes.Equal(out, in) {
		t.Errorf("недекодируемый формат должен пройти как есть: mediaType=%q", mt)
	}
}
