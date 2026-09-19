# Design System - Fast BG Remove (NVIDIA Precision)

## 1. Visual Theme & Atmosphere
Fast BG Remove pairs NVIDIA's engineering-grade, high-performance computing aesthetic with a lightning-fast client-side image utility. The system operates on a dual-mode surface architecture:
- **Night Mode (NVIDIA Dark)**: Deep charcoal/black canvas (`#0A0A0B`) with hairline dark borders (`#232326` / `#2E2E32`), elevated card surfaces (`#121214`), and vibrant NVIDIA Green (`#76B900`) accents.
- **Day Mode (NVIDIA Light)**: Clean white canvas (`#FFFFFF`), elevated card surfaces (`#F7F7F7` / `#FFFFFF`), border divider hairline (`#E5E5E5`), and deep black (`#000000` / `#1A1A1A`) typography.

## 2. Color Palette & Roles

### Brand & Primary
- **NVIDIA Green** (`#76B900`): Primary CTA ("Download Full HD PNG"), active indicators, focus rings, progress bars, signature corner squares
- **NVIDIA Green Pressed** (`#5A8D00`): Hover and active states for primary buttons
- **NVIDIA Green Subtle** (`rgba(118, 185, 0, 0.12)`): Active toggle pill backgrounds, telemetry badges
- **On-Primary Text**: Pure Black (`#000000`) with bold font weight

### Dark Mode (Night Canvas)
- **Dark Canvas**: `#0A0A0B`
- **Card Surface**: `#121214`
- **Elevated Surfaces / Pills**: `#1A1A1D`
- **Border Hairline**: `#232326`
- **Border Hover**: `#36363B`
- **Text Primary**: `#FFFFFF`
- **Text Secondary**: `#A7A7A7` (Ash / Mute)
- **Text Muted**: `#757575`

### Light Mode (Day Canvas)
- **Light Canvas**: `#FFFFFF`
- **Card Surface**: `#FFFFFF`
- **Elevated Surfaces / Pills**: `#F4F4F5`
- **Border Hairline**: `#E5E5E5`
- **Border Hover**: `#CCCCCC`
- **Text Primary**: `#000000`
- **Text Secondary**: `#5E5E5E`
- **Text Muted**: `#898989`

### Semantic & Presets
- **Success / 100% Client-Side**: `#76B900` (NVIDIA Green)
- **Pure White Preset**: `#FFFFFF`
- **Passport Blue Preset**: `#0055A5` (Official Consular Standard)
- **Error / Danger**: `#E52020`

## 3. Typography & Geometry Rules
- **Display & Headings**: Inter / Geist / NVIDIA-EMEA metrics, font-bold (`700`), tight tracking (`-0.02em`)
- **Code & Telemetry**: Geist Mono, SFMono-Regular, monospace
- **Hyper-Angular Geometry**: Extreme angularity — `2px` (`rounded-[2px]`) on buttons, inputs, pills, cards, and dropzone. Zero large circular bubbles or soft pill shapes.
- **Signature Motif**: 12px solid `#76B900` corner accent square on key cards and hero elements.

## 4. Component Stylings (NVIDIA Standards)
- **Primary CTA Button**:
  - Height: `44px` (`py-3 px-8`)
  - Background: `#76B900`
  - Text: `#000000`, bold (`font-bold`)
  - Radius: `2px` (`rounded-[2px]`)
  - Hover: `#5A8D00`
- **Secondary / Outline Buttons**:
  - Border: `1px solid #76B900` or neutral hairline
  - Radius: `2px` (`rounded-[2px]`)
- **Dropzone Viewport**:
  - Large hero element (`min-h-[440px]`), high contrast, generous spacing
  - Zero Vite / debug overlay artifacts
- **Persistent Header**:
  - Height: `64px` (`h-16`)
  - Brand logo from `/public/logo.svg` (`h-7 w-auto`) beside "FastBG"
  - Crisp Day/Night theme toggle (Sun/Moon)

## 5. Single-Viewport Discipline
The complete functional workspace (Header, Dropzone, Mode Toggles, Output Presets, and Download Button) is positioned above the fold on standard desktop displays (768px+) with immediate drag-and-drop and clipboard paste (`Ctrl+V`) readiness.
