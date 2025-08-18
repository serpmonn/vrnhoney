#!/bin/bash

# Скрипт для оптимизации изображений VRNHoney
# Требует установки ImageMagick и jpegoptim

echo "🍯 Оптимизация изображений для VRNHoney..."

# Проверяем наличие необходимых инструментов
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick не установлен. Установите: sudo apt-get install imagemagick"
    exit 1
fi

if ! command -v jpegoptim &> /dev/null; then
    echo "❌ jpegoptim не установлен. Установите: sudo apt-get install jpegoptim"
    exit 1
fi

# Создаем папку для оптимизированных изображений
mkdir -p images/optimized

# Оптимизируем фоновое изображение
echo "📸 Оптимизация фонового изображения..."
if [ -f "images/Background.jpeg" ]; then
    convert "images/Background.jpeg" -quality 85 -resize 1920x1080^ "images/optimized/Background-optimized.jpeg"
    jpegoptim --strip-all --max=80 "images/optimized/Background-optimized.jpeg"
    echo "✅ Background.jpeg оптимизирован"
fi

# Оптимизируем все изображения в галерее
echo "🖼️ Оптимизация изображений галереи..."
for img in images/*.jpg; do
    if [ -f "$img" ]; then
        filename=$(basename "$img")
        echo "Обрабатываю: $filename"
        
        # Создаем несколько размеров для адаптивности
        convert "$img" -quality 85 -resize 800x600^ "images/optimized/${filename%.*}-800w.jpg"
        convert "$img" -quality 85 -resize 400x300^ "images/optimized/${filename%.*}-400w.jpg"
        convert "$img" -quality 85 -resize 200x150^ "images/optimized/${filename%.*}-200w.jpg"
        
        # Оптимизируем каждый размер
        jpegoptim --strip-all --max=80 "images/optimized/${filename%.*}-800w.jpg"
        jpegoptim --strip-all --max=80 "images/optimized/${filename%.*}-400w.jpg"
        jpegoptim --strip-all --max=80 "images/optimized/${filename%.*}-200w.jpg"
    fi
done

# Оптимизируем изображения продуктов
echo "📦 Оптимизация изображений продуктов..."
for img in images/*g.jpg images/*c.jpg; do
    if [ -f "$img" ]; then
        filename=$(basename "$img")
        echo "Обрабатываю продукт: $filename"
        
        convert "$img" -quality 90 -resize 400x400^ "images/optimized/${filename%.*}-400w.jpg"
        convert "$img" -quality 90 -resize 200x200^ "images/optimized/${filename%.*}-200w.jpg"
        
        jpegoptim --strip-all --max=85 "images/optimized/${filename%.*}-400w.jpg"
        jpegoptim --strip-all --max=85 "images/optimized/${filename%.*}-200w.jpg"
    fi
done

# Создаем WebP версии для современных браузеров
echo "🌐 Создание WebP версий..."
for img in images/optimized/*.jpg; do
    if [ -f "$img" ]; then
        filename=$(basename "$img" .jpg)
        convert "$img" "images/optimized/${filename}.webp"
        echo "✅ Создан WebP: ${filename}.webp"
    fi
done

# Создаем отчет об оптимизации
echo "📊 Создание отчета об оптимизации..."
echo "# Отчет об оптимизации изображений VRNHoney" > "images/optimization-report.md"
echo "Дата: $(date)" >> "images/optimization-report.md"
echo "" >> "images/optimization-report.md"

echo "## Размеры файлов до оптимизации:" >> "images/optimization-report.md"
du -h images/*.jpg images/*.jpeg 2>/dev/null | sort -hr >> "images/optimization-report.md"

echo "" >> "images/optimization-report.md"
echo "## Размеры файлов после оптимизации:" >> "images/optimization-report.md"
du -h images/optimized/*.jpg images/optimized/*.webp 2>/dev/null | sort -hr >> "images/optimization-report.md"

echo "" >> "images/optimization-report.md"
echo "## Экономия места:" >> "images/optimization-report.md"
original_size=$(du -cb images/*.jpg images/*.jpeg 2>/dev/null | tail -1 | cut -f1)
optimized_size=$(du -cb images/optimized/*.jpg images/optimized/*.webp 2>/dev/null | tail -1 | cut -f1)
if [ ! -z "$original_size" ] && [ ! -z "$optimized_size" ]; then
    savings=$((original_size - optimized_size))
    savings_mb=$((savings / 1024 / 1024))
    echo "Экономия: ${savings_mb}MB (${savings} байт)" >> "images/optimization-report.md"
fi

echo "✅ Оптимизация завершена!"
echo "📁 Оптимизированные изображения сохранены в: images/optimized/"
echo "📊 Отчет сохранен в: images/optimization-report.md"
echo "🌐 WebP версии созданы для современных браузеров"

# Показываем статистику
echo ""
echo "📈 Статистика оптимизации:"
echo "Оригинальные изображения: $(ls images/*.jpg images/*.jpeg 2>/dev/null | wc -l)"
echo "Оптимизированные изображения: $(ls images/optimized/*.jpg 2>/dev/null | wc -l)"
echo "WebP версии: $(ls images/optimized/*.webp 2>/dev/null | wc -l)"