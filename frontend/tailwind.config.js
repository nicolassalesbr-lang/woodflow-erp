/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#030712", // Slate 950 deep dark
        card: "rgba(17, 24, 39, 0.7)", // Slate 900 translucent
        border: "rgba(75, 85, 99, 0.2)", // Gray 600 subtle
        primary: {
          DEFAULT: "#10b981", // Emerald 500
          hover: "#059669",
        },
        accent: {
          DEFAULT: "#06b6d4", // Cyan 500
          hover: "#0891b2",
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'grid-pattern': "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDQwIDQwIj48cGF0aCBkPSJNMCAwaDQwdjQwSDBWMHptMSAxaDM4djM4SDFWMXoiIGZpbGw9IiMzNzQxNTEiIGZpbGwtb3BhY2l0eT0iMC4xIi8+PC9zdmc+')",
      },
      boxShadow: {
        'glow-emerald': '0 0 15px rgba(16, 185, 129, 0.15)',
        'glow-cyan': '0 0 15px rgba(6, 182, 212, 0.15)',
        'premium-card': '0 10px 30px -10px rgba(0, 0, 0, 0.7)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
