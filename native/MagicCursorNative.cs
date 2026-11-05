using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Windows.Foundation;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace MagicCursorNative
{
    class Program
    {
        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("kernel32.dll")]
        static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        static extern bool IsZoomed(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);

        [DllImport("user32.dll")]
        static extern bool SetWindowPlacement(IntPtr hWnd, [In] ref WINDOWPLACEMENT lpwndpl);

        [DllImport("user32.dll", SetLastError = true)]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", SetLastError = true)]
        static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        const int GWL_STYLE = -16;
        const int WS_POPUP = unchecked((int)0x80000000);
        const int WS_THICKFRAME = 0x00040000;
        const int WS_MAXIMIZE = 0x01000000;
        const int WS_MINIMIZE = 0x20000000;
        const uint WM_SYSCOMMAND = 0x0112;
        const int SC_RESTORE = 0xF120;
        const uint SWP_FRAMECHANGED = 0x0020;
        const byte VK_F11 = 0x7A;

        [StructLayout(LayoutKind.Sequential)]
        public struct WINDOWPLACEMENT
        {
            public int length;
            public int flags;
            public int showCmd;
            public POINT ptMinPosition;
            public POINT ptMaxPosition;
            public RECT rcNormalPosition;
        }

        [DllImport("user32.dll")]
        static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("dwmapi.dll")]
        static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

        [DllImport("dwmapi.dll")]
        static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

        const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
        const int DWMWA_CLOAKED = 14;

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct CURSORINFO
        {
            public Int32 cbSize;
            public Int32 flags;
            public IntPtr hCursor;
            public POINT ptScreenPos;
        }

        const Int32 CURSOR_SHOWING = 0x00000001;

        [DllImport("user32.dll")]
        static extern bool GetCursorInfo(ref CURSORINFO pci);

        [DllImport("user32.dll")]
        static extern bool GetClipCursor(out RECT lprc);

        static bool IsGameOrMouseCaptureActive()
        {
            if (OverlayActive) return false;
            try
            {
                // 1. In 3D games (Minecraft, Valorant, CS2, etc.), during gameplay the OS hardware cursor
                // is hidden (`flags == 0`) while the game locks & re-centers the cursor every frame!
                // If the user opens their inventory or pauses (Esc), the game shows the cursor (`CURSOR_SHOWING`) again.
                CURSORINFO ci = new CURSORINFO();
                ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
                if (GetCursorInfo(ref ci))
                {
                    if ((ci.flags & CURSOR_SHOWING) == 0)
                    {
                        return true;
                    }
                }

                // 2. Also check if a game has locked the cursor into a small `ClipCursor` trap box
                RECT clipRect;
                if (GetClipCursor(out clipRect))
                {
                    Rectangle screenBounds = Screen.PrimaryScreen.Bounds;
                    int clipW = clipRect.Right - clipRect.Left;
                    int clipH = clipRect.Bottom - clipRect.Top;
                    if (clipW > 0 && clipH > 0 && (clipW < screenBounds.Width - 32 || clipH < screenBounds.Height - 32))
                    {
                        IntPtr fg = GetForegroundWindow();
                        if (fg != IntPtr.Zero && fg != OverlayHwnd)
                        {
                            RECT winRect;
                            if (GetWindowRect(fg, out winRect))
                            {
                                int winW = winRect.Right - winRect.Left;
                                int winH = winRect.Bottom - winRect.Top;
                                // If ClipCursor is smaller than a tiny center box (< 200x200), it's a 3D mouselook trap!
                                if (clipW < 200 && clipH < 200)
                                {
                                    return true;
                                }
                                // Or if the foreground window is fullscreen and clipping the cursor
                                if (winW >= screenBounds.Width && winH >= screenBounds.Height)
                                {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
            catch { }
            return false;
        }

        [DllImport("user32.dll")]
        static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        static extern IntPtr CreateCursor(IntPtr hInst, int xHotSpot, int yHotSpot, int nWidth, int nHeight, byte[] pvANDPlane, byte[] pvXORPlane);

        [DllImport("user32.dll")]
        static extern IntPtr CopyIcon(IntPtr hIcon);

        [DllImport("user32.dll")]
        static extern bool SetSystemCursor(IntPtr hcur, uint id);

        [DllImport("user32.dll")]
        static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);

        const uint SPI_SETCURSORS = 0x0057;
        static readonly uint[] SYSTEM_CURSOR_IDS = new uint[]
        {
            32512, // OCR_NORMAL
            32513, // OCR_IBEAM
            32514, // OCR_WAIT
            32515, // OCR_CROSS
            32516, // OCR_UP
            32642, // OCR_SIZENWSE
            32643, // OCR_SIZENESW
            32644, // OCR_SIZEWE
            32645, // OCR_SIZENS
            32646, // OCR_SIZEALL
            32648, // OCR_NO
            32649, // OCR_HAND
            32650  // OCR_APPSTARTING
        };
        static volatile bool SystemCursorsHidden = false;

        static void HideWindowsSystemCursors()
        {
            if (SystemCursorsHidden) return;
            SystemCursorsHidden = true;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    if (BlankCursorAndPlane == null)
                    {
                        BlankCursorAndPlane = new byte[128];
                        BlankCursorXorPlane = new byte[128];
                        for (int i = 0; i < 128; i++) BlankCursorAndPlane[i] = 0xFF;
                    }
                    IntPtr blankCursor = CreateCursor(IntPtr.Zero, 0, 0, 32, 32, BlankCursorAndPlane, BlankCursorXorPlane);
                    if (blankCursor != IntPtr.Zero)
                    {
                        foreach (uint id in SYSTEM_CURSOR_IDS)
                        {
                            if (!OverlayActive) break;
                            IntPtr copy = CopyIcon(blankCursor);
                            if (copy != IntPtr.Zero)
                            {
                                SetSystemCursor(copy, id);
                            }
                        }
                    }
                }
                catch { }
            });
        }

        static void RestoreWindowsSystemCursors()
        {
            if (!SystemCursorsHidden) return;
            SystemCursorsHidden = false;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    SystemParametersInfo(SPI_SETCURSORS, 0, IntPtr.Zero, 0);
                }
                catch { }
            });
        }

        static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        const uint SWP_SHOWWINDOW = 0x0040;
        const uint SWP_NOACTIVATE = 0x0010;

        const uint KEYEVENTF_KEYUP = 0x0002;
        const byte VK_MENU = 0x12;     // Alt
        const byte VK_CONTROL = 0x11;  // Ctrl
        const byte VK_RETURN = 0x0D;   // Enter
        const byte VK_ESCAPE = 0x1B;   // Esc
        const byte VK_SHIFT = 0x10;    // Shift
        const byte VK_SNAPSHOT = 0x2C; // Print Screen (PrtScn)
        const byte VK_S = 0x53;        // S
        const byte VK_LWIN = 0x5B;     // Left Windows key
        const byte VK_RWIN = 0x5C;     // Right Windows key
        const byte VK_G = 0x47;
        const byte VK_V = 0x56;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        struct Sample
        {
            public long TimeMs;
            public int X;
            public int Y;
            public double Vx;
            public double Vy;
        }

        // ContextualCursorSettingsUtil.java:16-19:
        // MIN_WIGGLE_SPEED = 0, MAX_WIGGLE_SPEED = 3, DEFAULT_WIGGLE_SPEED = 0
        static volatile int SensitivityLevel = 0;
        static volatile bool OverlayActive = false;
        static volatile bool HadOverlayFocus = false;
        static long OverlayActivatedAtMs = 0;
        static IntPtr OverlayHwnd = IntPtr.Zero;
        static readonly object BitmapLock = new object();
        static readonly object StdoutLock = new object();
        static Bitmap CachedDesktopBitmap = null;
        static string CachedScreenshotPath = Path.Combine(Path.GetTempPath(), "magic_pointer_latest_screenshot.jpg");
        static byte[] BlankCursorAndPlane = null;
        static byte[] BlankCursorXorPlane = null;
        static OcrEngine CachedOcrEngine = null;

        static OcrEngine GetOrCreateOcrEngine()
        {
            if (CachedOcrEngine == null)
            {
                try
                {
                    CachedOcrEngine = OcrEngine.TryCreateFromUserProfileLanguages();
                }
                catch { }
            }
            return CachedOcrEngine;
        }

        static void EmitJsonLine(string line)
        {
            lock (StdoutLock)
            {
                Console.Out.WriteLine(line);
                Console.Out.Flush();
            }
        }

        static void EnforceFullScreenOverlayBounds()
        {
            if (OverlayHwnd == IntPtr.Zero) return;
            try
            {
                Rectangle bounds = Screen.PrimaryScreen.Bounds;
                SetWindowPos(OverlayHwnd, HWND_TOPMOST, bounds.Left, bounds.Top, bounds.Width, bounds.Height, SWP_SHOWWINDOW);
                ForceOverlayForegroundFocus();
            }
            catch { }
        }

        static void ForceOverlayForegroundFocus()
        {
            if (OverlayHwnd == IntPtr.Zero) return;
            try
            {
                IntPtr fgHwnd = GetForegroundWindow();
                if (fgHwnd != OverlayHwnd)
                {
                    uint dummyPid;
                    uint fgThread = GetWindowThreadProcessId(fgHwnd, out dummyPid);
                    uint curThread = GetCurrentThreadId();
                    if (fgThread != 0 && fgThread != curThread)
                    {
                        AttachThreadInput(curThread, fgThread, true);
                        SetForegroundWindow(OverlayHwnd);
                        BringWindowToTop(OverlayHwnd);
                        AttachThreadInput(curThread, fgThread, false);
                    }
                    else
                    {
                        SetForegroundWindow(OverlayHwnd);
                        BringWindowToTop(OverlayHwnd);
                    }
                }
            }
            catch { }
        }

        [DllImport("user32.dll")]
        static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);

        const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        const uint MOUSEEVENTF_LEFTUP = 0x0004;

        [STAThread]
        static void Main(string[] args)
        {
            try { Console.OutputEncoding = Encoding.UTF8; } catch { }
            SetProcessDPIAware();

            if (args.Length > 0 && args[0] == "--capture")
            {
                if (args.Length >= 2)
                {
                    string outPath = args[1];
                    Rectangle bounds = Screen.PrimaryScreen.Bounds;
                    if (args.Length >= 6)
                    {
                        int x = int.Parse(args[2]);
                        int y = int.Parse(args[3]);
                        int w = Math.Max(4, int.Parse(args[4]));
                        int h = Math.Max(4, int.Parse(args[5]));
                        bounds = new Rectangle(x, y, w, h);
                    }
                    CaptureScreenToFile(bounds, outPath);
                }
                return;
            }

            if (args.Length > 0 && args[0] == "--send")
            {
                if (args.Length >= 2)
                {
                    RunSendMode(args[1]);
                }
                return;
            }

            if (args.Length > 0 && args[0] == "--open-gemini-app")
            {
                OpenAndPositionAiDesktopApp("gemini");
                return;
            }

            if (args.Length > 0 && args[0] == "--open-ai-app")
            {
                string target = args.Length >= 2 ? args[1] : "gemini";
                OpenAndPositionAiDesktopApp(target);
                return;
            }

            if (args.Length > 0 && args[0] == "--gen-icons")
            {
                string outDir = args.Length >= 2 ? args[1] : Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "extracted_assets");
                GenerateMagicPointerIcons(outDir);
                return;
            }

            RunWatchLoop();
        }

        // Exact vector path data from apk_decoded_base/res/drawable/magic_pointer_icon.xml
        const string MAGIC_POINTER_ARROW_PATH = "M8.824,7.271C7.986,6.495 6.623,7.046 6.559,8.186L5.85,20.875C5.789,21.95 7.066,22.554 7.859,21.826L11.892,18.124L17.364,17.986C18.44,17.958 18.939,16.637 18.149,15.906L8.824,7.271Z";
        const string MAGIC_POINTER_SPARKLE_PATH = "M18.35,5.685C17.888,5.486 17.483,5.213 17.136,4.867C16.789,4.52 16.517,4.115 16.318,3.653C16.241,3.476 16.18,3.294 16.133,3.107C16.118,3.046 16.063,3.003 16,3.003C15.937,3.003 15.882,3.046 15.867,3.107C15.82,3.294 15.759,3.475 15.682,3.653C15.483,4.115 15.21,4.52 14.864,4.867C14.517,5.213 14.112,5.486 13.65,5.685C13.473,5.762 13.291,5.823 13.104,5.87C13.043,5.885 13,5.94 13,6.003C13,6.066 13.043,6.121 13.104,6.136C13.291,6.183 13.472,6.244 13.65,6.321C14.112,6.52 14.517,6.792 14.864,7.139C15.21,7.486 15.483,7.891 15.682,8.353C15.759,8.53 15.82,8.712 15.867,8.899C15.882,8.96 15.937,9.003 16,9.003C16.063,9.003 16.118,8.96 16.133,8.899C16.18,8.712 16.241,8.53 16.318,8.353C16.517,7.891 16.789,7.486 17.136,7.139C17.483,6.792 17.888,6.519 18.35,6.321C18.527,6.244 18.709,6.183 18.896,6.136C18.957,6.121 19,6.066 19,6.003C19,5.94 18.957,5.885 18.896,5.87C18.709,5.823 18.528,5.762 18.35,5.685Z";

        static GraphicsPath ParseSvgPath(string d)
        {
            GraphicsPath gp = new GraphicsPath(FillMode.Winding);
            MatchCollection tokens = Regex.Matches(d, @"([MLCZmlcz])|([-+]?\d*\.?\d+)");
            int i = 0;
            string cmd = "";
            float cx = 0f, cy = 0f, sx = 0f, sy = 0f;
            while (i < tokens.Count)
            {
                string t = tokens[i].Value;
                if (Regex.IsMatch(t, "^[MLCZmlcz]$"))
                {
                    cmd = t;
                    i++;
                    if (cmd == "Z" || cmd == "z")
                    {
                        gp.CloseFigure();
                        cx = sx;
                        cy = sy;
                    }
                    continue;
                }
                if (cmd == "M")
                {
                    float nx = float.Parse(tokens[i].Value, CultureInfo.InvariantCulture);
                    float ny = float.Parse(tokens[i + 1].Value, CultureInfo.InvariantCulture);
                    i += 2;
                    gp.StartFigure();
                    cx = nx; cy = ny; sx = nx; sy = ny;
                    cmd = "L";
                }
                else if (cmd == "L")
                {
                    float nx = float.Parse(tokens[i].Value, CultureInfo.InvariantCulture);
                    float ny = float.Parse(tokens[i + 1].Value, CultureInfo.InvariantCulture);
                    i += 2;
                    gp.AddLine(cx, cy, nx, ny);
                    cx = nx; cy = ny;
                }
                else if (cmd == "C")
                {
                    float x1 = float.Parse(tokens[i].Value, CultureInfo.InvariantCulture);
                    float y1 = float.Parse(tokens[i + 1].Value, CultureInfo.InvariantCulture);
                    float x2 = float.Parse(tokens[i + 2].Value, CultureInfo.InvariantCulture);
                    float y2 = float.Parse(tokens[i + 3].Value, CultureInfo.InvariantCulture);
                    float nx = float.Parse(tokens[i + 4].Value, CultureInfo.InvariantCulture);
                    float ny = float.Parse(tokens[i + 5].Value, CultureInfo.InvariantCulture);
                    i += 6;
                    gp.AddBezier(cx, cy, x1, y1, x2, y2, nx, ny);
                    cx = nx; cy = ny;
                }
                else
                {
                    i++;
                }
            }
            return gp;
        }

        static byte[] RenderMagicPointerIconPng(GraphicsPath gp1, GraphicsPath gp2, int size, Color fgColor, bool withBadge, Color badgeBgColor)
        {
            using (Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.Clear(Color.Transparent);

                    if (withBadge)
                    {
                        float pad = size * 0.04f;
                        float diam = size - pad * 2f;
                        using (SolidBrush bgBrush = new SolidBrush(badgeBgColor))
                        {
                            g.FillEllipse(bgBrush, pad, pad, diam, diam);
                        }
                    }

                    float scale = (size / 24.0f) * (withBadge ? 0.86f : 1.14f);
                    g.TranslateTransform(size * 0.5f, size * 0.5f);
                    g.ScaleTransform(scale, scale);
                    g.TranslateTransform(-12.425f, -12.55f);

                    using (SolidBrush fgBrush = new SolidBrush(fgColor))
                    {
                        g.FillPath(fgBrush, gp1);
                        g.FillPath(fgBrush, gp2);
                    }
                }
                using (MemoryStream ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    return ms.ToArray();
                }
            }
        }

        static byte[] BuildMultiSizeIco(Dictionary<int, byte[]> pngMap)
        {
            int[] sizes = new int[] { 16, 24, 32, 48, 64, 128, 256 };
            using (MemoryStream ms = new MemoryStream())
            using (BinaryWriter bw = new BinaryWriter(ms))
            {
                bw.Write((ushort)0);
                bw.Write((ushort)1);
                bw.Write((ushort)sizes.Length);
                int offset = 6 + (sizes.Length * 16);
                foreach (int s in sizes)
                {
                    byte[] bytes = pngMap[s];
                    bw.Write((byte)(s == 256 ? 0 : s));
                    bw.Write((byte)(s == 256 ? 0 : s));
                    bw.Write((byte)0);
                    bw.Write((byte)0);
                    bw.Write((ushort)1);
                    bw.Write((ushort)32);
                    bw.Write((uint)bytes.Length);
                    bw.Write((uint)offset);
                    offset += bytes.Length;
                }
                foreach (int s in sizes)
                {
                    bw.Write(pngMap[s]);
                }
                bw.Flush();
                return ms.ToArray();
            }
        }

        static void GenerateMagicPointerIcons(string outDir)
        {
            Directory.CreateDirectory(outDir);
            using (GraphicsPath gp1 = ParseSvgPath(MAGIC_POINTER_ARROW_PATH))
            using (GraphicsPath gp2 = ParseSvgPath(MAGIC_POINTER_SPARKLE_PATH))
            {
                // 1. Monochrome white-on-transparent for dark taskbar/status bar (Googlebook status bar style: #E2E2E9)
                Color monoLight = Color.FromArgb(255, 240, 240, 247);
                // 2. Monochrome dark-on-transparent for light taskbar/status bar (#191C20)
                Color monoDark = Color.FromArgb(255, 25, 28, 32);
                // 3. Material You tonal circle + primary glyph for desktop/window icon (#282A2F circle + #A8C7FA glyph)
                Color m3Surface = Color.FromArgb(255, 40, 42, 47);
                Color m3Primary = Color.FromArgb(255, 168, 199, 250);

                int[] sizes = new int[] { 16, 20, 24, 32, 48, 64, 128, 256 };
                Dictionary<int, byte[]> trayDarkMap = new Dictionary<int, byte[]>();
                Dictionary<int, byte[]> trayLightMap = new Dictionary<int, byte[]>();
                Dictionary<int, byte[]> appBadgeMap = new Dictionary<int, byte[]>();

                foreach (int s in sizes)
                {
                    trayDarkMap[s] = RenderMagicPointerIconPng(gp1, gp2, s, monoLight, false, Color.Transparent);
                    trayLightMap[s] = RenderMagicPointerIconPng(gp1, gp2, s, monoDark, false, Color.Transparent);
                    appBadgeMap[s] = RenderMagicPointerIconPng(gp1, gp2, s, m3Primary, true, m3Surface);
                }

                File.WriteAllBytes(Path.Combine(outDir, "icon.png"), trayDarkMap[256]);
                File.WriteAllBytes(Path.Combine(outDir, "tray_icon_dark.png"), trayDarkMap[32]);
                File.WriteAllBytes(Path.Combine(outDir, "tray_icon_light.png"), trayLightMap[32]);
                File.WriteAllBytes(Path.Combine(outDir, "icon.ico"), BuildMultiSizeIco(trayDarkMap));
                File.WriteAllBytes(Path.Combine(outDir, "icon_light.ico"), BuildMultiSizeIco(trayLightMap));
                File.WriteAllBytes(Path.Combine(outDir, "app_icon.ico"), BuildMultiSizeIco(appBadgeMap));
            }
        }

        static void UpdateCachedDesktopBitmap()
        {
            try
            {
                Rectangle bounds = Screen.PrimaryScreen.Bounds;
                Bitmap bmp = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                }
                lock (BitmapLock)
                {
                    if (CachedDesktopBitmap != null)
                    {
                        CachedDesktopBitmap.Dispose();
                    }
                    CachedDesktopBitmap = bmp;
                }
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    try
                    {
                        byte[] pngBytes = null;
                        int sw = bounds.Width;
                        int sh = bounds.Height;
                        lock (BitmapLock)
                        {
                            if (CachedDesktopBitmap != null)
                            {
                                using (MemoryStream ms = new MemoryStream())
                                {
                                    CachedDesktopBitmap.Save(ms, ImageFormat.Jpeg);
                                    pngBytes = ms.ToArray();
                                }
                            }
                        }
                        if (pngBytes != null)
                        {
                            File.WriteAllBytes(CachedScreenshotPath, pngBytes);
                            EmitJsonLine(string.Format("{{\"type\":\"screenshot\",\"path\":\"{0}\",\"width\":{1},\"height\":{2}}}", EscapeJson(CachedScreenshotPath), sw, sh));
                            RunWinRtOcrOnPngBytes(pngBytes, sw, sh);
                        }
                    }
                    catch { }
                });
            }
            catch { }
        }

        static T WaitWinRt<T>(IAsyncOperation<T> op)
        {
            using (ManualResetEventSlim ev = new ManualResetEventSlim(false))
            {
                op.Completed = (info, status) => ev.Set();
                if (op.Status != AsyncStatus.Started) ev.Set();
                ev.Wait(2500);
                if (op.Status == AsyncStatus.Completed)
                {
                    return op.GetResults();
                }
                return default(T);
            }
        }

        static void RunWinRtOcrOnPngBytes(byte[] pngBytes, int screenW, int screenH)
        {
            try
            {
                OcrEngine engine = GetOrCreateOcrEngine();
                if (engine == null) return;

                using (InMemoryRandomAccessStream stream = new InMemoryRandomAccessStream())
                {
                    using (DataWriter writer = new DataWriter(stream.GetOutputStreamAt(0)))
                    {
                        writer.WriteBytes(pngBytes);
                        WaitWinRt(writer.StoreAsync());
                        writer.DetachStream();
                    }
                    stream.Seek(0);
                    BitmapDecoder decoder = WaitWinRt(BitmapDecoder.CreateAsync(stream));
                    if (decoder == null) return;
                    SoftwareBitmap softBmp = WaitWinRt(decoder.GetSoftwareBitmapAsync());
                    if (softBmp == null) return;
                    using (softBmp)
                    {
                        OcrResult res = WaitWinRt(engine.RecognizeAsync(softBmp));
                        if (res == null || res.Lines == null) return;

                        StringBuilder sb = new StringBuilder();
                        sb.Append("{\"type\":\"ocr\",\"screenW\":").Append(screenW).Append(",\"screenH\":").Append(screenH).Append(",\"lines\":[");
                        bool firstLine = true;
                        foreach (OcrLine line in res.Lines)
                        {
                            if (line == null || line.Words == null || line.Words.Count == 0) continue;
                            if (!firstLine) sb.Append(",");
                            firstLine = false;
                            sb.Append("{\"text\":\"").Append(EscapeJson(line.Text)).Append("\",\"words\":[");
                            bool firstWord = true;
                            foreach (OcrWord word in line.Words)
                            {
                                if (!firstWord) sb.Append(",");
                                firstWord = false;
                                Rect r = word.BoundingRect;
                                sb.Append("{\"text\":\"").Append(EscapeJson(word.Text))
                                  .Append("\",\"x\":").Append((int)Math.Round(r.X))
                                  .Append(",\"y\":").Append((int)Math.Round(r.Y))
                                  .Append(",\"w\":").Append(Math.Max(2, (int)Math.Round(r.Width)))
                                  .Append(",\"h\":").Append(Math.Max(2, (int)Math.Round(r.Height)))
                                  .Append("}");
                            }
                            sb.Append("]}");
                        }
                        sb.Append("]}");
                        EmitJsonLine(sb.ToString());
                    }
                }
            }
            catch { }
        }

        static string RecognizeTextFromBitmapSync(Bitmap bmp)
        {
            try
            {
                OcrEngine engine = GetOrCreateOcrEngine();
                if (engine == null) return "";

                // Pad & upscale small crops (e.g. a single URL, email, or phone number selection)
                // so Windows OcrEngine never fails or misreads characters due to tight edges or small font height!
                int scale = (bmp.Height < 120 || bmp.Width < 260) ? 2 : 1;
                int pad = 24;
                int targetW = bmp.Width * scale + pad * 2;
                int targetH = bmp.Height * scale + pad * 2;

                byte[] pngBytes;
                using (Bitmap padded = new Bitmap(targetW, targetH, PixelFormat.Format32bppArgb))
                {
                    Color edgeBg = Color.White;
                    try
                    {
                        Color c1 = bmp.GetPixel(Math.Min(2, bmp.Width - 1), Math.Min(2, bmp.Height - 1));
                        Color c2 = bmp.GetPixel(Math.Max(0, bmp.Width - 3), Math.Max(0, bmp.Height - 3));
                        edgeBg = Color.FromArgb(255, (c1.R + c2.R) / 2, (c1.G + c2.G) / 2, (c1.B + c2.B) / 2);
                    }
                    catch { }

                    using (Graphics g = Graphics.FromImage(padded))
                    {
                        g.SmoothingMode = SmoothingMode.HighQuality;
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.Clear(edgeBg);
                        g.DrawImage(bmp, new Rectangle(pad, pad, bmp.Width * scale, bmp.Height * scale));
                    }

                    using (MemoryStream ms = new MemoryStream())
                    {
                        padded.Save(ms, ImageFormat.Png);
                        pngBytes = ms.ToArray();
                    }
                }

                using (InMemoryRandomAccessStream stream = new InMemoryRandomAccessStream())
                {
                    using (DataWriter writer = new DataWriter(stream.GetOutputStreamAt(0)))
                    {
                        writer.WriteBytes(pngBytes);
                        WaitWinRt(writer.StoreAsync());
                        writer.DetachStream();
                    }
                    stream.Seek(0);
                    BitmapDecoder decoder = WaitWinRt(BitmapDecoder.CreateAsync(stream));
                    if (decoder == null) return "";
                    SoftwareBitmap softBmp = WaitWinRt(decoder.GetSoftwareBitmapAsync());
                    if (softBmp == null) return "";
                    using (softBmp)
                    {
                        OcrResult res = WaitWinRt(engine.RecognizeAsync(softBmp));
                        if (res == null || res.Lines == null) return "";
                        StringBuilder sb = new StringBuilder();
                        foreach (OcrLine line in res.Lines)
                        {
                            if (line != null && !string.IsNullOrWhiteSpace(line.Text))
                            {
                                if (sb.Length > 0) sb.Append("\n");
                                sb.Append(line.Text.Trim());
                            }
                        }
                        return sb.ToString();
                    }
                }
            }
            catch
            {
                return "";
            }
        }

        static void CropFromMemoryOrScreen(string reqId, int x, int y, int w, int h, string outPath)
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    Bitmap croppedCopy = null;
                    lock (BitmapLock)
                    {
                        if (CachedDesktopBitmap != null)
                        {
                            int rx = Math.Max(0, Math.Min(x, CachedDesktopBitmap.Width - 4));
                            int ry = Math.Max(0, Math.Min(y, CachedDesktopBitmap.Height - 4));
                            int rw = Math.Max(4, Math.Min(w, CachedDesktopBitmap.Width - rx));
                            int rh = Math.Max(4, Math.Min(h, CachedDesktopBitmap.Height - ry));
                            Rectangle rect = new Rectangle(rx, ry, rw, rh);
                            croppedCopy = CachedDesktopBitmap.Clone(rect, CachedDesktopBitmap.PixelFormat);
                        }
                    }

                    if (croppedCopy == null)
                    {
                        Rectangle fallbackRect = new Rectangle(x, y, Math.Max(4, w), Math.Max(4, h));
                        croppedCopy = new Bitmap(fallbackRect.Width, fallbackRect.Height, PixelFormat.Format32bppArgb);
                        using (Graphics g = Graphics.FromImage(croppedCopy))
                        {
                            g.CopyFromScreen(fallbackRect.Left, fallbackRect.Top, 0, 0, fallbackRect.Size, CopyPixelOperation.SourceCopy);
                        }
                    }

                    string cropOcrText = "";
                    using (croppedCopy)
                    {
                        croppedCopy.Save(outPath, ImageFormat.Png);
                        cropOcrText = RecognizeTextFromBitmapSync(croppedCopy);
                    }

                    EmitJsonLine(string.Format("{{\"type\":\"cropped\",\"id\":\"{0}\",\"ok\":true,\"ocrText\":\"{1}\"}}", reqId, EscapeJson(cropOcrText)));
                }
                catch
                {
                    EmitJsonLine(string.Format("{{\"type\":\"cropped\",\"id\":\"{0}\",\"ok\":false}}", reqId));
                }
            });
        }

        static void CaptureScreenToFile(Rectangle rect, string outPath)
        {
            try
            {
                using (Bitmap bmp = new Bitmap(rect.Width, rect.Height, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.CopyFromScreen(rect.Left, rect.Top, 0, 0, rect.Size, CopyPixelOperation.SourceCopy);
                    }
                    bmp.Save(outPath, ImageFormat.Png);
                }
            }
            catch { }
        }

        static string EscapeJson(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            StringBuilder sb = new StringBuilder(s.Length + 8);
            foreach (char c in s)
            {
                if (c == '\\') sb.Append("\\\\");
                else if (c == '"') sb.Append("\\\"");
                else if (c == '\r' || c == '\n' || c == '\t') sb.Append(' ');
                else if (c < 0x20 || (c >= 0x7F && c <= 0x9F))
                {
                    // Strip control characters (like \u0007 bullet noise from OCR) so JSON.parse never fails!
                    continue;
                }
                else
                {
                    sb.Append(c);
                }
            }
            return sb.ToString();
        }

        static void EmitWindowAOIs()
        {
            try
            {
                Rectangle screenBounds = Screen.PrimaryScreen.Bounds;
                int screenW = screenBounds.Width;
                int screenH = screenBounds.Height;
                StringBuilder json = new StringBuilder();
                json.Append("{\"type\":\"windows\",\"screenW\":").Append(screenW).Append(",\"screenH\":").Append(screenH).Append(",\"rects\":[");
                bool first = true;

                EnumWindows((hWnd, lParam) =>
                {
                    if (!IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;

                    int cloaked = 0;
                    if (DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, Marshal.SizeOf(typeof(int))) == 0 && cloaked != 0)
                    {
                        return true;
                    }

                    StringBuilder clsSb = new StringBuilder(128);
                    GetClassName(hWnd, clsSb, 128);
                    string cls = clsSb.ToString();
                    if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd")
                    {
                        return true;
                    }

                    StringBuilder titleSb = new StringBuilder(256);
                    GetWindowText(hWnd, titleSb, 256);
                    string title = titleSb.ToString();
                    if (string.IsNullOrWhiteSpace(title) || title == "Magic Pointer")
                    {
                        return true;
                    }

                    RECT r;
                    if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) != 0)
                    {
                        if (!GetWindowRect(hWnd, out r)) return true;
                    }

                    // Exact GeneralPostProcessor.kt bounds coercion (1 .. screenW-1, 1 .. screenH-1)
                    int left = Math.Max(1, Math.Min(r.Left, screenW - 1));
                    int top = Math.Max(1, Math.Min(r.Top, screenH - 1));
                    int right = Math.Max(1, Math.Min(r.Right, screenW - 1));
                    int bottom = Math.Max(1, Math.Min(r.Bottom, screenH - 1));
                    int w = right - left;
                    int h = bottom - top;

                    // GeneralPostProcessor.kt line 61: MIN_BOUNDING_BOX_SIZE = 40
                    if (Math.Min(w, h) < 40) return true;

                    // GeneralPostProcessor.kt line 57:
                    // if (category == WINDOW && (width >= screenWidth * 0.95f || height >= screenHeight * 0.95f)) -> FILTERED OUT!
                    if (w >= screenW * 0.95f || h >= screenH * 0.95f)
                    {
                        return true;
                    }

                    if (!first) json.Append(",");
                    first = false;
                    json.Append("{\"x\":").Append(left)
                        .Append(",\"y\":").Append(top)
                        .Append(",\"width\":").Append(w)
                        .Append(",\"height\":").Append(h)
                        .Append(",\"category\":\"WINDOW\"")
                        .Append(",\"title\":\"").Append(EscapeJson(title)).Append("\"}");
                    return true;
                }, IntPtr.Zero);

                json.Append("]}");
                EmitJsonLine(json.ToString());
            }
            catch { }
        }

        static void RunWatchLoop()
        {
            AppDomain.CurrentDomain.ProcessExit += (s, e) => RestoreWindowsSystemCursors();

            Thread stdinThread = new Thread(() =>
            {
                try
                {
                    string line;
                    while ((line = Console.ReadLine()) != null)
                    {
                        line = line.Trim();
                        if (line.StartsWith("SENSITIVITY:"))
                        {
                            int lvl;
                            if (int.TryParse(line.Substring("SENSITIVITY:".Length), out lvl))
                            {
                                SensitivityLevel = Math.Max(0, Math.Min(3, lvl));
                            }
                        }
                        else if (line.StartsWith("ACTIVE:"))
                        {
                            OverlayActive = line.Substring("ACTIVE:".Length).Trim() == "1";
                            if (OverlayActive)
                            {
                                HadOverlayFocus = false;
                                OverlayActivatedAtMs = Environment.TickCount & Int32.MaxValue;
                                EnforceFullScreenOverlayBounds();
                                HideWindowsSystemCursors();
                            }
                            else
                            {
                                HadOverlayFocus = false;
                                RestoreWindowsSystemCursors();
                            }
                        }
                        else if (line.StartsWith("HWND:"))
                        {
                            long val;
                            if (long.TryParse(line.Substring("HWND:".Length).Trim(), out val))
                            {
                                OverlayHwnd = new IntPtr(val);
                            }
                        }
                        else if (line == "FOCUS")
                        {
                            ForceOverlayForegroundFocus();
                        }
                        else if (line == "SNAPSHOT")
                        {
                            UpdateCachedDesktopBitmap();
                        }
                        else if (line == "GET_WINDOWS")
                        {
                            EmitWindowAOIs();
                        }
                        else if (line.StartsWith("OPEN_AI:"))
                        {
                            string appTarget = line.Substring("OPEN_AI:".Length).Trim();
                            Thread t = new Thread(() =>
                            {
                                try { OpenAndPositionAiDesktopApp(appTarget); } catch { }
                            });
                            t.SetApartmentState(ApartmentState.STA);
                            t.IsBackground = true;
                            t.Start();
                        }
                        else if (line.StartsWith("SEND:"))
                        {
                            string payloadFile = line.Substring("SEND:".Length).Trim();
                            Thread t = new Thread(() =>
                            {
                                try { RunSendMode(payloadFile); } catch { }
                            });
                            t.SetApartmentState(ApartmentState.STA);
                            t.IsBackground = true;
                            t.Start();
                        }
                        else if (line.StartsWith("CROP:"))
                        {
                            // Format: CROP:reqId|x|y|w|h|outPath
                            string[] parts = line.Substring(5).Split(new char[] { '|' }, 6);
                            if (parts.Length == 6)
                            {
                                string reqId = parts[0];
                                int cx = int.Parse(parts[1]);
                                int cy = int.Parse(parts[2]);
                                int cw = int.Parse(parts[3]);
                                int ch = int.Parse(parts[4]);
                                string outPath = parts[5];
                                CropFromMemoryOrScreen(reqId, cx, cy, cw, ch, outPath);
                            }
                        }
                    }
                }
                catch { }
                finally
                {
                    RestoreWindowsSystemCursors();
                }
            });
            stdinThread.IsBackground = true;
            stdinThread.Start();

            List<Sample> history = new List<Sample>(64);
            Stopwatch sw = Stopwatch.StartNew();

            POINT prevPt;
            GetCursorPos(out prevPt);
            long prevMs = sw.ElapsedMilliseconds;
            long lastShakeMs = -5000;
            bool prevEscDown = false;
            bool prevWinGDown = false;

            while (true)
            {
                Thread.Sleep(8); // 125Hz low-latency polling, zero stdout spam
                long nowMs = sw.ElapsedMilliseconds;
                long dt = Math.Max(1, nowMs - prevMs);

                POINT pt;
                if (!GetCursorPos(out pt)) continue;

                // Detect Windows + G (VK_LWIN / VK_RWIN + VK_G) globally at the OS level
                bool winDown = ((GetAsyncKeyState(VK_LWIN) & 0x8000) != 0) || ((GetAsyncKeyState(VK_RWIN) & 0x8000) != 0);
                bool gDown = (GetAsyncKeyState(VK_G) & 0x8000) != 0;
                bool winGDown = winDown && gDown;
                if (winGDown && !prevWinGDown)
                {
                    if (!OverlayActive)
                    {
                        UpdateCachedDesktopBitmap();
                    }
                    EmitJsonLine(string.Format("{{\"type\":\"hotkey\",\"x\":{0},\"y\":{1}}}", pt.X, pt.Y));
                }
                prevWinGDown = winGDown;

                // Check rising-edge Esc key, screenshot keys (PrtScn / Win+Shift+S), foreground focus loss,
                // and stream cursor position when overlay is active
                if (OverlayActive)
                {
                    bool escDown = (GetAsyncKeyState(VK_ESCAPE) & 0x8000) != 0;
                    bool prtScnDown = (GetAsyncKeyState(VK_SNAPSHOT) & 0x8000) != 0;
                    bool shiftDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
                    bool sDown = (GetAsyncKeyState(VK_S) & 0x8000) != 0;
                    bool winShiftSDown = winDown && shiftDown && sDown;

                    if ((escDown && !prevEscDown) || prtScnDown || winShiftSDown)
                    {
                        EmitJsonLine(prtScnDown || winShiftSDown ? "{\"type\":\"focus_lost\"}" : "{\"type\":\"esc\"}");
                    }
                    prevEscDown = escDown;

                    // MainActivityPeer.java:1520-1670 (onWindowFocusChanged / dismissOnFocusLoss):
                    // If another app or screenshot tool (Snipping Tool, ScreenClippingHost, Lightshot, ShareX, Alt+Tab, etc.)
                    // takes over foreground focus, automatically dismiss Magic Pointer!
                    if (OverlayHwnd != IntPtr.Zero)
                    {
                        IntPtr fg = GetForegroundWindow();
                        if (fg == OverlayHwnd)
                        {
                            HadOverlayFocus = true;
                        }
                        else if (fg != IntPtr.Zero)
                        {
                            StringBuilder clsSb = new StringBuilder(128);
                            GetClassName(fg, clsSb, 128);
                            string cls = clsSb.ToString();
                            StringBuilder titleSb = new StringBuilder(256);
                            GetWindowText(fg, titleSb, 256);
                            string title = titleSb.ToString();

                            bool isScreenshotOverlay =
                                cls.IndexOf("ScreenClipping", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                title.IndexOf("Snipping", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                title.IndexOf("Screen Snip", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                title.IndexOf("Lightshot", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                title.IndexOf("ShareX", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                title.IndexOf("Greenshot", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                title.IndexOf("Flameshot", StringComparison.OrdinalIgnoreCase) >= 0;

                            int curTick = Environment.TickCount & Int32.MaxValue;
                            if (isScreenshotOverlay || (HadOverlayFocus && (curTick - OverlayActivatedAtMs) > 450))
                            {
                                HadOverlayFocus = false;
                                EmitJsonLine("{\"type\":\"focus_lost\"}");
                            }
                        }
                    }

                    if (pt.X != prevPt.X || pt.Y != prevPt.Y)
                    {
                        EmitJsonLine(string.Format("{{\"type\":\"move\",\"x\":{0},\"y\":{1}}}", pt.X, pt.Y));
                    }
                }
                else
                {
                    prevEscDown = false;
                }

                double vx = (double)(pt.X - prevPt.X) / dt;
                double vy = (double)(pt.Y - prevPt.Y) / dt;

                history.Add(new Sample { TimeMs = nowMs, X = pt.X, Y = pt.Y, Vx = vx, Vy = vy });

                long cutoff = nowMs - 420;
                while (history.Count > 0 && history[0].TimeMs < cutoff)
                {
                    history.RemoveAt(0);
                }

                // Map wiggleSpeed (0..3, default 2) to detection thresholds:
                // - Speed 0 (Level 1): requires 4 reversals, higher speed (0.60 px/ms), longer path (260px)
                // - Speed 1 (Level 2): requires 3 reversals, medium speed (0.48 px/ms), path (210px)
                // - Speed 2 (Level 3, Default): requires 3 reversals, standard speed (0.36 px/ms), path (160px)
                // - Speed 3 (Level 4): requires 2 reversals, light speed (0.24 px/ms), short path (110px)
                int requiredReversals = 4 - ((SensitivityLevel + 1) / 2); // 0->4, 1->3, 2->3, 3->2
                if (requiredReversals < 2) requiredReversals = 2;
                double minSpeed = 0.60 - (SensitivityLevel * 0.12); // px/ms
                double minTotalPath = 260 - (SensitivityLevel * 50);

                int reversalsX = 0;
                int reversalsY = 0;
                int lastSignX = 0;
                int lastSignY = 0;
                double totalPath = 0;
                int minX = int.MaxValue, maxX = int.MinValue;
                int minY = int.MaxValue, maxY = int.MinValue;

                for (int i = 1; i < history.Count; i++)
                {
                    int dx = history[i].X - history[i - 1].X;
                    int dy = history[i].Y - history[i - 1].Y;
                    double seg = Math.Sqrt(dx * dx + dy * dy);
                    totalPath += seg;

                    if (history[i].X < minX) minX = history[i].X;
                    if (history[i].X > maxX) maxX = history[i].X;
                    if (history[i].Y < minY) minY = history[i].Y;
                    if (history[i].Y > maxY) maxY = history[i].Y;

                    if (Math.Abs(history[i].Vx) > minSpeed)
                    {
                        int sx = history[i].Vx > 0 ? 1 : -1;
                        if (lastSignX != 0 && sx != lastSignX) reversalsX++;
                        lastSignX = sx;
                    }
                    if (Math.Abs(history[i].Vy) > minSpeed)
                    {
                        int sy = history[i].Vy > 0 ? 1 : -1;
                        if (lastSignY != 0 && sy != lastSignY) reversalsY++;
                        lastSignY = sy;
                    }
                }

                int totalReversals = Math.Max(reversalsX, reversalsY);
                double bboxDiag = (minX <= maxX) ? Math.Sqrt((maxX - minX) * (maxX - minX) + (maxY - minY) * (maxY - minY)) : 0;

                bool isBackAndForth = bboxDiag > 14 && bboxDiag < 560 && (totalPath / Math.Max(1.0, bboxDiag)) >= 1.75;
                bool lButtonDown = (GetAsyncKeyState(0x01) & 0x8000) != 0;
                bool rButtonDown = (GetAsyncKeyState(0x02) & 0x8000) != 0;

                if (!OverlayActive && IsGameOrMouseCaptureActive())
                {
                    history.Clear();
                }
                else if (!lButtonDown && !rButtonDown && isBackAndForth && totalReversals >= requiredReversals && totalPath >= minTotalPath && (nowMs - lastShakeMs) > 750)
                {
                    lastShakeMs = nowMs;
                    history.Clear();

                    if (!OverlayActive)
                    {
                        // Fast ~6ms in-RAM BitBlt before overlay appears so crops are 100% clean
                        UpdateCachedDesktopBitmap();
                    }

                    EmitJsonLine(string.Format("{{\"type\":\"shake\",\"x\":{0},\"y\":{1},\"reversals\":{2}}}", pt.X, pt.Y, totalReversals));
                }

                prevPt = pt;
                prevMs = nowMs;
            }
        }

        const int SW_RESTORE = 9;
        const uint SWP_NOZORDER = 0x0004;

        static IntPtr FindAiDesktopAppWindow(string targetApp)
        {
            string app = (targetApp ?? "gemini").Trim().ToLowerInvariant();
            IntPtr foundExact = IntPtr.Zero;
            IntPtr foundFallback = IntPtr.Zero;
            EnumWindows((hWnd, lParam) =>
            {
                if (!IsWindowVisible(hWnd)) return true;
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString();
                if (string.IsNullOrEmpty(title)) return true;
                if (title.IndexOf("Magic Pointer", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    title.IndexOf("Magic Cursor", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }

                // Ignore Chrome / Edge / Brave / Firefox browser tabs so we ONLY target standalone AI Desktop Apps!
                if (title.IndexOf("Google Chrome", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    title.IndexOf("Microsoft\u200b Edge", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    title.IndexOf("Microsoft Edge", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    title.IndexOf("Brave", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    title.IndexOf("Mozilla Firefox", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }

                uint pid = 0;
                GetWindowThreadProcessId(hWnd, out pid);
                string procName = "";
                if (pid != 0)
                {
                    try
                    {
                        using (Process p = Process.GetProcessById((int)pid))
                        {
                            procName = p.ProcessName ?? "";
                        }
                    }
                    catch { }
                }

                if (procName.Equals("chrome", StringComparison.OrdinalIgnoreCase) ||
                    procName.Equals("msedge", StringComparison.OrdinalIgnoreCase) ||
                    procName.Equals("brave", StringComparison.OrdinalIgnoreCase) ||
                    procName.Equals("firefox", StringComparison.OrdinalIgnoreCase) ||
                    procName.Equals("cursor", StringComparison.OrdinalIgnoreCase) ||
                    procName.Equals("Code", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }

                if (app == "claude")
                {
                    if (procName.IndexOf("claude", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        title.Trim().Equals("Claude", StringComparison.OrdinalIgnoreCase))
                    {
                        foundExact = hWnd;
                        return false;
                    }
                    if (title.IndexOf("Claude", StringComparison.OrdinalIgnoreCase) >= 0 && foundFallback == IntPtr.Zero)
                    {
                        foundFallback = hWnd;
                    }
                }
                else if (app == "chatgpt")
                {
                    if (procName.IndexOf("ChatGPT", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        procName.Equals("Codex", StringComparison.OrdinalIgnoreCase) ||
                        title.Trim().Equals("ChatGPT", StringComparison.OrdinalIgnoreCase))
                    {
                        foundExact = hWnd;
                        return false;
                    }
                    if ((title.IndexOf("ChatGPT", StringComparison.OrdinalIgnoreCase) >= 0 ||
                         title.IndexOf("Codex", StringComparison.OrdinalIgnoreCase) >= 0) &&
                        foundFallback == IntPtr.Zero)
                    {
                        foundFallback = hWnd;
                    }
                }
                else
                {
                    if (procName.IndexOf("Gemini", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        title.Trim().Equals("Gemini", StringComparison.OrdinalIgnoreCase) ||
                        title.IndexOf("Google Gemini", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        foundExact = hWnd;
                        return false;
                    }
                    if (title.IndexOf("Gemini", StringComparison.OrdinalIgnoreCase) >= 0 && foundFallback == IntPtr.Zero)
                    {
                        foundFallback = hWnd;
                    }
                }
                return true;
            }, IntPtr.Zero);
            return foundExact != IntPtr.Zero ? foundExact : foundFallback;
        }

        static void SendWinShiftG()
        {
            // Trigger the Gemini Desktop App's native global shortcut (`Win + Shift + G` from `%APPDATA%\gemini\settings.json`)
            keybd_event(VK_LWIN, 0, 0, UIntPtr.Zero);
            keybd_event(VK_SHIFT, 0, 0, UIntPtr.Zero);
            Thread.Sleep(25);
            keybd_event(VK_G, 0, 0, UIntPtr.Zero);
            Thread.Sleep(25);
            keybd_event(VK_G, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            Thread.Sleep(25);
            keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        static void SendCtrlV()
        {
            keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
            Thread.Sleep(25);
            keybd_event(VK_V, 0, 0, UIntPtr.Zero);
            Thread.Sleep(25);
            keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            Thread.Sleep(25);
            keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        static void SendEnterKey()
        {
            keybd_event(VK_RETURN, 0, 0, UIntPtr.Zero);
            Thread.Sleep(25);
            keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        // Ensure the OpenAI ChatGPT / Codex Desktop App opens in Chat Mode (`selectedSurface = "chat"`, `sidePanelSelectedSurface = "chat"`)
        static void EnsureChatGptDesktopChatModeConfig()
        {
            try
            {
                string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string stateFile = Path.Combine(userProfile, ".codex", ".codex-global-state.json");
                if (!File.Exists(stateFile)) return;
                string raw = File.ReadAllText(stateFile, Encoding.UTF8);
                string updated = Regex.Replace(raw, "\"selectedSurface\"\\s*:\\s*\"[^\"]*\"", "\"selectedSurface\":\"chat\"");
                updated = Regex.Replace(updated, "\"sidePanelSelectedSurface\"\\s*:\\s*\"[^\"]*\"", "\"sidePanelSelectedSurface\":\"chat\"");
                if (updated != raw)
                {
                    File.WriteAllText(stateFile, updated, Encoding.UTF8);
                }
            }
            catch { }
        }

        static bool TryLaunchAiDesktopAppExecutable(string targetApp)
        {
            string app = (targetApp ?? "gemini").Trim().ToLowerInvariant();
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string winApps = Path.Combine(localAppData, @"Microsoft\WindowsApps");

            if (app == "claude")
            {
                string[] claudeExes = new string[]
                {
                    Path.Combine(winApps, "claude-desktop.exe"),
                    Path.Combine(localAppData, @"AnthropicClaude\claude.exe"),
                    Path.Combine(localAppData, @"Programs\Claude\Claude.exe"),
                    Path.Combine(localAppData, @"Programs\claude\claude.exe")
                };
                foreach (string exe in claudeExes)
                {
                    if (File.Exists(exe))
                    {
                        try
                        {
                            Process.Start(new ProcessStartInfo
                            {
                                FileName = exe,
                                WorkingDirectory = Path.GetDirectoryName(exe),
                                UseShellExecute = true
                            });
                            return true;
                        }
                        catch { }
                    }
                }
                string claudeLnk = Path.Combine(appData, @"Microsoft\Windows\Start Menu\Programs\Claude.lnk");
                if (File.Exists(claudeLnk))
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo { FileName = claudeLnk, UseShellExecute = true });
                        return true;
                    }
                    catch { }
                }
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "explorer.exe",
                        Arguments = @"shell:AppsFolder\Claude_pzs8sxrjxfjjc!Claude",
                        UseShellExecute = true
                    });
                    return true;
                }
                catch { }
                return false;
            }

            if (app == "chatgpt")
            {
                EnsureChatGptDesktopChatModeConfig();
                string[] chatGptExes = new string[]
                {
                    Path.Combine(winApps, "chatgpt-desktop.exe"),
                    Path.Combine(localAppData, @"Programs\ChatGPT\ChatGPT.exe"),
                    Path.Combine(localAppData, @"ChatGPT\ChatGPT.exe"),
                    Path.Combine(localAppData, @"OpenAI\ChatGPT\ChatGPT.exe")
                };
                foreach (string exe in chatGptExes)
                {
                    if (File.Exists(exe))
                    {
                        try
                        {
                            Process.Start(new ProcessStartInfo
                            {
                                FileName = exe,
                                UseShellExecute = true
                            });
                            return true;
                        }
                        catch { }
                    }
                }
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "explorer.exe",
                        Arguments = @"shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App",
                        UseShellExecute = true
                    });
                    return true;
                }
                catch { }
                return false;
            }

            string[] candidateExes = new string[]
            {
                Path.Combine(localAppData, @"Google\Gemini\Gemini.exe"),
                Path.Combine(localAppData, @"Google\Gemini\GeminiAppLauncher.exe"),
                Path.Combine(localAppData, @"Programs\Gemini\Gemini.exe"),
                Path.Combine(localAppData, @"Gemini\Gemini.exe"),
                @"C:\Program Files\Google\Gemini\Gemini.exe",
                @"C:\Program Files (x86)\Google\Gemini\Gemini.exe"
            };

            foreach (string exe in candidateExes)
            {
                if (File.Exists(exe))
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = exe,
                            WorkingDirectory = Path.GetDirectoryName(exe),
                            UseShellExecute = true
                        });
                        return true;
                    }
                    catch { }
                }
            }

            return false;
        }

        static Rectangle GetCompanionWindowBounds()
        {
            Rectangle workArea = Screen.PrimaryScreen.WorkingArea;
            int margin = Math.Max(16, (int)Math.Round(workArea.Width * 0.012));
            int targetW = Math.Max(460, Math.Min(560, (int)Math.Round(workArea.Width * 0.29)));
            int targetH = Math.Max(640, Math.Min(workArea.Height - margin * 2, (int)Math.Round(workArea.Height * 0.84)));
            int targetX = workArea.Right - targetW - margin;
            int targetY = workArea.Top + Math.Max(margin, (workArea.Height - targetH) / 2);
            return new Rectangle(targetX, targetY, targetW, targetH);
        }

        // Pre-seed `%APPDATA%\gemini\settings.json` with the Magic Pointer companion window bounds
        // so if the Gemini Desktop App is cold-launched or un-minimized, its own `windowBounds`
        // restoration logic (`Ta()` / `ct()` in `app.asar`) uses the exact companion dimensions
        // instead of snapping back to the user's previous full-screen / 1200x900 dimensions!
        static void SyncGeminiSettingsWindowBoundsToCompanion()
        {
            try
            {
                string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                string settingsPath = Path.Combine(appData, "gemini", "settings.json");
                if (!File.Exists(settingsPath)) return;

                Rectangle workArea = Screen.PrimaryScreen.WorkingArea;
                Rectangle comp = GetCompanionWindowBounds();
                int relX = comp.X - workArea.X;
                int relY = comp.Y - workArea.Y;

                string raw = File.ReadAllText(settingsPath, Encoding.UTF8);
                string updated = raw;
                updated = Regex.Replace(updated, "(\"windowBounds\"\\s*:\\s*\\{[^}]*?\"width\"\\s*:\\s*)\\d+", "${1}" + comp.Width);
                updated = Regex.Replace(updated, "(\"windowBounds\"\\s*:\\s*\\{[^}]*?\"height\"\\s*:\\s*)\\d+", "${1}" + comp.Height);
                updated = Regex.Replace(updated, "(\"windowBounds\"\\s*:\\s*\\{[^}]*?\"relativeX\"\\s*:\\s*)-?\\d+", "${1}" + relX);
                updated = Regex.Replace(updated, "(\"windowBounds\"\\s*:\\s*\\{[^}]*?\"relativeY\"\\s*:\\s*)-?\\d+", "${1}" + relY);

                if (updated != raw)
                {
                    File.WriteAllText(settingsPath, updated, Encoding.UTF8);
                }
            }
            catch { }
        }

        // Exact port of Googlebook RobinKit non-fullscreen companion window behavior
        // (`TextQuery.shouldUseFullScreenMode = false` in `RobinKitServiceGrpcClientImpl.java:455-516`):
        // Un-maximizes / exits F11 full-screen on the target AI Desktop App and resizes/docks it into
        // a floating companion window on the right side of the work area every time Magic Pointer sends!
        static void ResizeAndFocusCompanionWindow(IntPtr appHwnd)
        {
            if (appHwnd == IntPtr.Zero) return;
            try
            {
                Rectangle screenBounds = Screen.PrimaryScreen.Bounds;
                Rectangle comp = GetCompanionWindowBounds();

                // 1. Bring to foreground first so any F11 / WM_SYSCOMMAND / SetWindowPlacement applies cleanly
                uint dummyPid;
                uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out dummyPid);
                uint appThread = GetWindowThreadProcessId(appHwnd, out dummyPid);
                uint curThread = GetCurrentThreadId();

                if (fgThread != 0 && fgThread != curThread) AttachThreadInput(curThread, fgThread, true);
                if (appThread != 0 && appThread != curThread) AttachThreadInput(curThread, appThread, true);

                // 2. If the window is in F11 Chromium/Electron FullScreen mode (covering the entire monitor
                //    including the taskbar and lacking WS_THICKFRAME or having WS_POPUP), toggle F11 off
                //    and restore WS_THICKFRAME so Electron's BaseWindow leaves fullscreen!
                RECT curRect;
                if (GetWindowRect(appHwnd, out curRect))
                {
                    int curW = curRect.Right - curRect.Left;
                    int curH = curRect.Bottom - curRect.Top;
                    int style = GetWindowLong(appHwnd, GWL_STYLE);
                    bool coversFullMonitor = (curW >= screenBounds.Width && curH >= screenBounds.Height);
                    bool isFramelessFullscreen = coversFullMonitor && !IsZoomed(appHwnd) && ((style & WS_THICKFRAME) == 0 || (style & WS_POPUP) != 0);

                    if (isFramelessFullscreen)
                    {
                        SetForegroundWindow(appHwnd);
                        BringWindowToTop(appHwnd);
                        Thread.Sleep(30);
                        keybd_event(VK_F11, 0, 0, UIntPtr.Zero);
                        Thread.Sleep(20);
                        keybd_event(VK_F11, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                        Thread.Sleep(120);

                        int newStyle = (style & ~WS_POPUP & ~WS_MAXIMIZE & ~WS_MINIMIZE) | WS_THICKFRAME;
                        SetWindowLong(appHwnd, GWL_STYLE, newStyle);
                    }
                }

                // 3. If maximized (`IsZoomed`) or minimized (`IsIconic`), send `SC_RESTORE` + `ShowWindow(SW_RESTORE)`
                if (IsZoomed(appHwnd) || IsIconic(appHwnd))
                {
                    SendMessage(appHwnd, WM_SYSCOMMAND, new IntPtr(SC_RESTORE), IntPtr.Zero);
                    ShowWindow(appHwnd, SW_RESTORE);
                    Thread.Sleep(80);
                }

                // 4. Update `WINDOWPLACEMENT.rcNormalPosition` AND call `SetWindowPos` twice (with a short delay)
                //    so even if Electron's `unmaximize` / `restore` listener tries to restore the user's previous
                //    custom/fullscreen bounds asynchronously, it is overridden with the Magic Pointer companion bounds!
                WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
                wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
                if (GetWindowPlacement(appHwnd, ref wp))
                {
                    wp.showCmd = SW_RESTORE;
                    wp.rcNormalPosition.Left = comp.Left;
                    wp.rcNormalPosition.Top = comp.Top;
                    wp.rcNormalPosition.Right = comp.Right;
                    wp.rcNormalPosition.Bottom = comp.Bottom;
                    SetWindowPlacement(appHwnd, ref wp);
                }

                SetWindowPos(appHwnd, IntPtr.Zero, comp.X, comp.Y, comp.Width, comp.Height, SWP_NOZORDER | SWP_SHOWWINDOW | SWP_FRAMECHANGED);
                Thread.Sleep(90);
                SetWindowPos(appHwnd, IntPtr.Zero, comp.X, comp.Y, comp.Width, comp.Height, SWP_NOZORDER | SWP_SHOWWINDOW);

                SetForegroundWindow(appHwnd);
                BringWindowToTop(appHwnd);

                if (appThread != 0 && appThread != curThread) AttachThreadInput(curThread, appThread, false);
                if (fgThread != 0 && fgThread != curThread) AttachThreadInput(curThread, fgThread, false);
            }
            catch { }
        }

        static void ClickAndFocusComposerInput(IntPtr appHwnd, string targetApp)
        {
            if (appHwnd == IntPtr.Zero) return;
            try
            {
                // Ensure the window is foregrounded
                SetForegroundWindow(appHwnd);
                BringWindowToTop(appHwnd);
                Thread.Sleep(60);

                // In Gemini, Claude, and ChatGPT desktop Electron apps, the prompt composer box sits
                // horizontally centered near the bottom of the companion window (~88% height).
                // Clicking inside the composer area ensures the inner WebContentsView / rich-textarea
                // receives keyboard focus before we send Ctrl+V and Enter!
                RECT r;
                if (GetWindowRect(appHwnd, out r))
                {
                    int w = r.Right - r.Left;
                    int h = r.Bottom - r.Top;
                    if (w > 200 && h > 200)
                    {
                        POINT origPt;
                        GetCursorPos(out origPt);

                        int clickX = r.Left + (w / 2);
                        int clickY = r.Bottom - Math.Max(68, (int)Math.Round(h * 0.11));
                        Cursor.Position = new System.Drawing.Point(clickX, clickY);
                        Thread.Sleep(30);
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                        Thread.Sleep(20);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                        Thread.Sleep(60);

                        Cursor.Position = new System.Drawing.Point(origPt.X, origPt.Y);
                    }
                }
            }
            catch { }
        }

        static IntPtr OpenAndPositionSingleAiApp(string appId)
        {
            string app = (appId ?? "gemini").Trim().ToLowerInvariant();
            if (app == "chatgpt")
            {
                EnsureChatGptDesktopChatModeConfig();
            }
            else if (app == "gemini")
            {
                SyncGeminiSettingsWindowBoundsToCompanion();
            }

            IntPtr appHwnd = FindAiDesktopAppWindow(app);
            if (appHwnd != IntPtr.Zero)
            {
                ResizeAndFocusCompanionWindow(appHwnd);
                Thread.Sleep(240);
                return appHwnd;
            }

            bool launchedExe = TryLaunchAiDesktopAppExecutable(app);
            if (!launchedExe && app == "gemini")
            {
                SendWinShiftG();
            }

            for (int i = 0; i < 32; i++)
            {
                Thread.Sleep(125);
                appHwnd = FindAiDesktopAppWindow(app);
                if (appHwnd != IntPtr.Zero)
                {
                    ResizeAndFocusCompanionWindow(appHwnd);
                    Thread.Sleep(550);
                    return appHwnd;
                }
            }

            return IntPtr.Zero;
        }

        static IntPtr OpenAndPositionAiDesktopApp(string preferredApp)
        {
            string pref = (preferredApp ?? "gemini").Trim().ToLowerInvariant();
            // Build fallback order: preferred -> gemini -> claude -> chatgpt
            List<string> order = new List<string>();
            order.Add(pref);
            if (!order.Contains("gemini")) order.Add("gemini");
            if (!order.Contains("claude")) order.Add("claude");
            if (!order.Contains("chatgpt")) order.Add("chatgpt");

            foreach (string candidate in order)
            {
                IntPtr hwnd = OpenAndPositionSingleAiApp(candidate);
                if (hwnd != IntPtr.Zero)
                {
                    return hwnd;
                }
            }
            return IntPtr.Zero;
        }

        static void RunSendMode(string payloadPath)
        {
            if (!File.Exists(payloadPath)) return;
            string[] lines = File.ReadAllLines(payloadPath, Encoding.UTF8);
            string targetApp = "gemini";
            string prompt = "";
            List<string> imageFiles = new List<string>();
            List<string> otherFiles = new List<string>();

            foreach (string raw in lines)
            {
                string line = raw.Trim();
                if (line.StartsWith("TARGET_APP:"))
                {
                    targetApp = line.Substring("TARGET_APP:".Length).Trim().ToLowerInvariant();
                }
                else if (line.StartsWith("PROMPT_B64:"))
                {
                    byte[] bytes = Convert.FromBase64String(line.Substring("PROMPT_B64:".Length));
                    prompt = Encoding.UTF8.GetString(bytes);
                }
                else if (line.StartsWith("IMAGE:"))
                {
                    string p = line.Substring("IMAGE:".Length).Trim();
                    if (File.Exists(p)) imageFiles.Add(p);
                }
                else if (line.StartsWith("FILE:"))
                {
                    string p = line.Substring("FILE:".Length).Trim();
                    if (File.Exists(p)) otherFiles.Add(p);
                }
            }

            IntPtr aiHwnd = OpenAndPositionAiDesktopApp(targetApp);
            if (aiHwnd == IntPtr.Zero) return;

            ClickAndFocusComposerInput(aiHwnd, targetApp);

            foreach (string imgPath in imageFiles)
            {
                try
                {
                    using (Image img = Image.FromFile(imgPath))
                    {
                        Clipboard.SetImage(img);
                    }
                    Thread.Sleep(100);
                    SendCtrlV();
                    Thread.Sleep(380);
                }
                catch { }
            }

            if (otherFiles.Count > 0)
            {
                try
                {
                    StringCollection sc = new StringCollection();
                    foreach (string fp in otherFiles) sc.Add(fp);
                    Clipboard.SetFileDropList(sc);
                    Thread.Sleep(100);
                    SendCtrlV();
                    Thread.Sleep(400);
                }
                catch { }
            }

            if (!string.IsNullOrWhiteSpace(prompt))
            {
                try
                {
                    Clipboard.SetText(prompt);
                    Thread.Sleep(100);
                    SendCtrlV();
                    Thread.Sleep(180);
                    SendEnterKey();
                }
                catch { }
            }
            else if (imageFiles.Count > 0 || otherFiles.Count > 0)
            {
                Thread.Sleep(160);
                SendEnterKey();
            }
        }
    }
}
