package main

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
)

// Anthropic масштабирует картинки длинной стороной больше 1568 px на своей
// стороне и режет запросы тяжелее 5 МБ. Скрин с retina-экрана пробивает оба
// порога, поэтому ужимаем до отправки: меньше токенов и нет отказа по размеру.
const (
	maxImageDimension = 1568
	maxImageBytes     = 3 << 20
)

// shrinkForAPI возвращает уменьшенный JPEG, если исходник слишком велик.
// Формат, который стандартная библиотека не умеет декодировать (WebP), и
// картинки в пределах лимитов возвращаются как есть.
func shrinkForAPI(data []byte, mediaType string) ([]byte, string) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, mediaType
	}
	b := src.Bounds()
	long := max(b.Dx(), b.Dy())
	if long <= maxImageDimension && len(data) <= maxImageBytes {
		return data, mediaType
	}

	scaled := src
	if long > maxImageDimension {
		w := b.Dx() * maxImageDimension / long
		h := b.Dy() * maxImageDimension / long
		scaled = downscale(src, max(w, 1), max(h, 1))
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, scaled, &jpeg.Options{Quality: 85}); err != nil {
		return data, mediaType
	}
	// Ровный градиент или скриншот с плоской заливкой в PNG жмётся лучше JPEG.
	// Токены считаются по размеру после масштабирования на стороне API, так что
	// выигрыш здесь только в байтах — если его нет, отправляем оригинал.
	if buf.Len() >= len(data) && len(data) <= maxImageBytes {
		return data, mediaType
	}
	return buf.Bytes(), "image/jpeg"
}

// downscale усредняет исходные пиксели по прямоугольнику назначения: для
// уменьшения этого достаточно, а зависимости ради ресемплинга не нужны.
func downscale(src image.Image, w, h int) image.Image {
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	rgba := image.NewRGBA(b)
	draw.Draw(rgba, b, src, b.Min, draw.Src)

	for y := range h {
		y0 := b.Min.Y + y*b.Dy()/h
		y1 := max(b.Min.Y+(y+1)*b.Dy()/h, y0+1)
		for x := range w {
			x0 := b.Min.X + x*b.Dx()/w
			x1 := max(b.Min.X+(x+1)*b.Dx()/w, x0+1)

			var r, g, bl, a, n uint32
			for sy := y0; sy < y1; sy++ {
				for sx := x0; sx < x1; sx++ {
					pr, pg, pb, pa := rgba.At(sx, sy).RGBA()
					r += pr >> 8
					g += pg >> 8
					bl += pb >> 8
					a += pa >> 8
					n++
				}
			}
			dst.Set(x, y, color.RGBA{
				R: uint8(r / n),
				G: uint8(g / n),
				B: uint8(bl / n),
				A: uint8(a / n),
			})
		}
	}
	return dst
}
