# 🚀 Quick Start Guide - Sistema Shawarma Desktop App

## ⚡ 30-Second Setup

```bash
# 1. Build the app
cd apps/desktop
npm run build:electron

# 2. Run the app
run-app.cmd

# Or run directly:
# .\dist-app\win-unpacked\Sistema Shawarma.exe
```

## ✅ What You Get

- **Standalone Application** (192.79 MB)
- **No Installation Required** - runs directly
- **Portable** - can be copied anywhere
- **Production Ready** - fully functional

## 📦 Build Command

### From Desktop App Directory
```bash
npm run build:electron
```

Output will be in: `dist-app/win-unpacked/Sistema Shawarma.exe`

### From Root Directory
```bash
npm run build:desktop
```

## 🎯 Features Included

✅ React-based UI with Vite optimization  
✅ Electron desktop runtime  
✅ PDF report generation (print to PDF)  
✅ File dialogs for saving reports  
✅ IPC communication support  
✅ Multi-window capable  

## 📁 File Structure

```
apps/desktop/
├── dist-app/
│   └── win-unpacked/
│       └── Sistema Shawarma.exe      ← Run this!
├── dist/                             ← Built React UI
├── electron/                         ← Electron main process
├── src/                             ← React source code
├── build-app.mjs                    ← Build script
├── run-app.cmd                      ← Launcher script
└── BUILD_GUIDE.md                   ← Full documentation
```

## 🔧 Development

```bash
# Development server with hot reload
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint
```

## 📚 Learn More

See detailed guides:
- `BUILD_GUIDE.md` - Comprehensive build documentation
- `DESKTOP_APP_SETUP.md` - Setup details and troubleshooting

---

**Ready to go!** 🎉
