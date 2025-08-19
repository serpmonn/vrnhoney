#!/bin/bash

# ========================================
# СКРИПТ ОПТИМИЗАЦИИ ИЗОБРАЖЕНИЙ VRNHoney
# ========================================
# 
# Этот скрипт автоматически оптимизирует все изображения на сайте VRNHoney
# для улучшения производительности и уменьшения размера файлов.
# 
# Функции скрипта:
# - Автоматическое изменение размеров изображений
# - Сжатие JPEG с сохранением качества
# - Создание WebP версий для современных браузеров
# - Генерация отчетов об оптимизации
# 
# Требования:
# - ImageMagick (для изменения размеров и конвертации)
# - jpegoptim (для сжатия JPEG)
# 
# Автор: Cursor Agent
# Дата: 19 декабря 2024
# Версия: 2.0.0

echo "🍯 Оптимизация изображений для VRNHoney..."

# ========================================
# ПРОВЕРКА ЗАВИСИМОСТЕЙ
# ========================================

# Проверяем наличие ImageMagick для обработки изображений
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick не установлен. Установите: sudo apt-get install imagemagick"
    exit 1
fi

# Проверяем наличие jpegoptim для сжатия JPEG файлов
if ! command -v jpegoptim &> /dev/null; then
    echo "❌ jpegoptim не установлен. Установите: sudo apt-get install jpegoptim"
    exit 1
fi

# Создаем папку для оптимизированных изображений
mkdir -p images/optimized

# ========================================
# ОПТИМИЗАЦИЯ ФОНОВОГО ИЗОБРАЖЕНИЯ
# ========================================

# Оптимизируем основное фоновое изображение сайта
echo "📸 Оптимизация фонового изображения..."
if [ -f "images/Background.jpeg" ]; then
    # Изменяем размер до Full HD (1920x1080) с сохранением пропорций
    convert "images/Background.jpeg" -quality 85 -resize 1920x1080^ "images/optimized/Background-optimized.jpeg"
    
    # Сжимаем JPEG до 80% качества для уменьшения размера
    jpegoptim --strip-all --max=80 "images/optimized/Background-optimized.jpeg"
    
    echo "✅ Background.jpeg оптимизирован"
fi

# ========================================
# ОПТИМИЗАЦИЯ ИЗОБРАЖЕНИЙ ГАЛЕРЕИ
# ========================================

# Обрабатываем все изображения в галерее для создания адаптивных версий
echo "🖼️ Оптимизация изображений галереи..."
for img in images/*.jpg; do
    if [ -f "$img" ]; then
        filename=$(basename "$img")
        echo "Обрабатываю: $filename"
        
        # Создаем несколько размеров для адаптивности (responsive images)
        # 800w - для больших экранов
        convert "$img" -quality 85 -resize 800x600^ "images/optimized/${filename%.*}-800w.jpg"
        # 400w - для средних экранов
        convert "$img" -quality 85 -resize 400x300^ "images/optimized/${filename%.*}-400w.jpg"
        # 200w - для мобильных устройств
        convert "$img" -quality 85 -resize 200x150^ "images/optimized/${filename%.*}-200w.jpg"
        
        # Оптимизируем каждый размер для уменьшения размера файла
        jpegoptim --strip-all --max=80 "images/optimized/${filename%.*}-800w.jpg"
        jpegoptim --strip-all --max=80 "images/optimized/${filename%.*}-400w.jpg"
        jpegoptim --strip-all --max=80 "images/optimized/${filename%.*}-200w.jpg"
    fi
done

# ========================================
# СОЗДАНИЕ WEBP ВЕРСИЙ
# ========================================

# Создаем WebP версии для современных браузеров
# WebP обеспечивает лучшее сжатие при сохранении качества
echo "🌐 Создание WebP версий..."
for img in images/optimized/*.jpg; do
    if [ -f "$img" ]; then
        filename=$(basename "$img" .jpg)
        # Конвертируем JPEG в WebP с автоматическим определением качества
        convert "$img" "images/optimized/${filename}.webp"
        echo "✅ Создан WebP: ${filename}.webp"
    fi
done

# ========================================
# СОЗДАНИЕ ОТЧЕТА ОБ ОПТИМИЗАЦИИ
# ========================================

# Генерируем подробный отчет о проделанной работе
echo "📊 Создание отчета об оптимизации..."
echo "# Отчет об оптимизации изображений VRNHoney" > "images/optimization-report.md"
echo "Дата: $(date)" >> "images/optimization-report.md"
echo "" >> "images/optimization-report.md"
echo "## 📈 Результаты оптимизации" >> "images/optimization-report.md"
echo "" >> "images/optimization-report.md"
echo "### Фоновое изображение" >> "images/optimization-report.md"
if [ -f "images/Background.jpeg" ] && [ -f "images/optimized/Background-optimized.jpeg" ]; then
    original_size=$(du -h "images/Background.jpeg" | cut -f1)
    optimized_size=$(du -h "images/optimized/Background-optimized.jpeg" | cut -f1)
    echo "- Оригинал: $original_size" >> "images/optimization-report.md"
    echo "- Оптимизировано: $optimized_size" >> "images/optimization-report.md"
fi
echo "" >> "images/optimization-report.md"
echo "### Галерея изображений" >> "images/optimization-report.md"
echo "- Создано адаптивных версий: $(ls images/optimized/*-800w.jpg 2>/dev/null | wc -l)" >> "images/optimization-report.md"
echo "- WebP версий: $(ls images/optimized/*.webp 2>/dev/null | wc -l)" >> "images/optimization-report.md"
echo "" >> "images/optimization-report.md"
echo "## 🛠️ Использованные инструменты" >> "images/optimization-report.md"
echo "- ImageMagick: $(convert --version | head -1)" >> "images/optimization-report.md"
echo "- jpegoptim: $(jpegoptim --version | head -1)" >> "images/optimization-report.md"
echo "" >> "images/optimization-report.md"
echo "## 📱 Рекомендации по использованию" >> "images/optimization-report.md"
echo "1. Используйте изображения с суффиксом -800w для больших экранов" >> "images/optimization-report.md"
echo "2. Используйте изображения с суффиксом -400w для планшетов" >> "images/optimization-report.md"
echo "3. Используйте изображения с суффиксом -200w для мобильных устройств" >> "images/optimization-report.md"
echo "4. WebP версии для современных браузеров с поддержкой этого формата" >> "images/optimization-report.md"

echo "✅ Отчет сохранен в: images/optimization-report.md"
echo "🌐 WebP версии созданы для современных браузеров"

# ========================================
# ВЫВОД СТАТИСТИКИ ОПТИМИЗАЦИИ
# ========================================

# Показываем итоговую статистику по проделанной работе
echo ""
echo "📈 Статистика оптимизации:"
echo "Оригинальные изображения: $(ls images/*.jpg images/*.jpeg 2>/dev/null | wc -l)"
echo "Оптимизированные изображения: $(ls images/optimized/*.jpg 2>/dev/null | wc -l)"
echo "WebP версии: $(ls images/optimized/*.webp 2>/dev/null | wc -l)"

echo ""
echo "🎉 Оптимизация изображений завершена!"
echo "📁 Результаты сохранены в папке: images/optimized/"