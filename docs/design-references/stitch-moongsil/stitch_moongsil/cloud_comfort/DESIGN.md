---
name: Cloud Comfort
colors:
  surface: '#fbf9f8'
  surface-dim: '#dbd9d9'
  surface-bright: '#fbf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3f3'
  surface-container: '#efeded'
  surface-container-high: '#eae8e7'
  surface-container-highest: '#e4e2e2'
  on-surface: '#1b1c1c'
  on-surface-variant: '#49454f'
  inverse-surface: '#303030'
  inverse-on-surface: '#f2f0f0'
  outline: '#7a7580'
  outline-variant: '#cac4d0'
  surface-tint: '#655592'
  primary: '#625290'
  on-primary: '#ffffff'
  primary-container: '#7b6baa'
  on-primary-container: '#fffbff'
  inverse-primary: '#cfbdff'
  secondary: '#376666'
  on-secondary: '#ffffff'
  secondary-container: '#bbeceb'
  on-secondary-container: '#3e6c6c'
  tertiary: '#72545c'
  on-tertiary: '#ffffff'
  tertiary-container: '#8c6c74'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e8ddff'
  primary-fixed-dim: '#cfbdff'
  on-primary-fixed: '#200e4b'
  on-primary-fixed-variant: '#4c3d79'
  secondary-fixed: '#bbeceb'
  secondary-fixed-dim: '#9fcfcf'
  on-secondary-fixed: '#002020'
  on-secondary-fixed-variant: '#1d4e4e'
  tertiary-fixed: '#ffd9e1'
  tertiary-fixed-dim: '#e3bdc5'
  on-tertiary-fixed: '#2b151b'
  on-tertiary-fixed-variant: '#5b3f46'
  background: '#fbf9f8'
  on-background: '#1b1c1c'
  surface-variant: '#e4e2e2'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  container-max: 1200px
  gutter: 24px
---

## Brand & Style

The design system is built on a "Reliable yet Whimsical" narrative, specifically tailored for professional habit tracking. It balances the playful softness of a personal wellness app with the structured precision required for productivity. 

The aesthetic is a hybrid of **Minimalism** and **Glassmorphism**. It utilizes expansive white space and a soft pastel palette to reduce cognitive load, while employing frosted glass effects to establish a sense of depth and modern sophistication. The emotional goal is to evoke a sense of calm accomplishment—making the act of tracking habits feel like a gentle ritual rather than a rigid chore.

## Colors

The palette uses low-saturation pastels to maintain a professional "cloud-like" atmosphere. 

- **Primary (#8E7DBE):** Used for focus states, primary actions, and "Habit Complete" indicators. It provides the necessary contrast against light backgrounds.
- **Secondary (#A6D6D6):** Used for progress bars and calm instructional elements.
- **Accents (#F7CFD8 & #F4F8D3):** Used for categorization and background subtle washes to differentiate habit types.
- **Surface:** Pure white (#FFFFFF) is the base, with a very light grey (#F9FAFB) used for secondary containers.
- **Text:** A deep charcoal (#4A4A4A) is used instead of pure black to maintain the soft aesthetic while ensuring high legibility.

## Typography

This design system utilizes **Plus Jakarta Sans** across all levels to leverage its modern, rounded terminals which echo the "Cloud" theme. 

- **Headlines:** Use Bold or SemiBold weights with slight negative letter spacing to create a compact, professional look.
- **Body Text:** Standardized at 16px for optimal readability. Use a "Regular" weight (400) to keep the interface feeling light.
- **Labels:** Small caps are used sparingly for metadata (e.g., "STREAK COUNT") to add a touch of professional rigor to the whimsical style.

## Layout & Spacing

The layout is built on a strict **8pt grid system**. This ensures that even with soft shapes and pastel colors, the underlying structure feels engineered and reliable.

- **Grid:** A 12-column fluid grid for desktop and a 4-column fluid grid for mobile.
- **Margins:** 24px fixed side margins on mobile; centered containers with 1200px max-width on desktop.
- **Padding:** Use `md` (16px) for internal card padding and `lg` (24px) for section vertical spacing.
- **Alignment:** Content should generally be left-aligned to assist in rapid scanning of habit lists.

## Elevation & Depth

To achieve the "Cloud Comfort" feel, depth is communicated through **Ambient Shadows** and **Glassmorphism**, avoiding harsh borders.

- **Shadows:** Use three-layered box shadows. A very large, low-opacity spread (0.05 alpha) creates a "lifting" effect from the background without looking dirty.
- **Glassmorphism:** Navigation bars and modal overlays utilize a `backdrop-filter: blur(12px)` with a semi-transparent white fill (`rgba(255, 255, 255, 0.7)`). This allows the soft background colors to peek through, maintaining a sense of place.
- **Tonal Tiers:** Level 0 is the background; Level 1 is the standard Habit Card; Level 2 is the Active/Focused card.

## Shapes

The shape language is consistently **Rounded**. 

- **Cards & Containers:** Use `rounded-lg` (16px) as the default to reinforce the "soft" brand identity.
- **Buttons:** Primary buttons should use `rounded-xl` (24px) or be fully pill-shaped to invite interaction.
- **Icons:** Ensure icons have rounded caps and corners to match the typography and container shapes.

## Components

### Habit Cards
The central component of this design system, defined by three explicit states:
- **Empty/Inactive:** A dashed border in a light grey, no shadow, with a faint secondary color background. Used for upcoming habits or empty slots.
- **Active:** White background, Level 2 ambient shadow, 2px solid primary border. This highlights the current task.
- **Completed:** Subtle transition to a solid secondary color (#A6D6D6) background with a checkmark icon. Shadow is reduced to Level 1 to show the task is "settled."

### Buttons
- **Primary:** Solid Primary color (#8E7DBE) with white text. High elevation on hover.
- **Secondary:** Frosted glass effect with a primary color outline.

### Input Fields
- Soft grey background with no border in resting state. Transition to a white background with a primary color glow (shadow) on focus.

### Progress Rings
- Thin, circular strokes using the secondary and tertiary colors to track habit streaks visually without adding bulk to the UI.