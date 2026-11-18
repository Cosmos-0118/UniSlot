using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using UniSlot.Desktop.Services;

namespace UniSlot.Desktop.Views;

public partial class MainWindow : Window
{
    private readonly AppSettings? _preferences;

    public MainWindow() : this(null) { }

    public MainWindow(AppSettings? preferences)
    {
        InitializeComponent();
        _preferences = preferences;

        Shell.PickWorkbook = async () =>
        {
            var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
            {
                AllowMultiple = false,
                FileTypeFilter = [new FilePickerFileType("Excel") { Patterns = ["*.xlsx", "*.xlsm"] }],
            });
            return files.Count > 0 ? files[0].TryGetLocalPath() : null;
        };

        Shell.OpenFolder = path =>
        {
            if (Directory.Exists(path)) _ = Launcher.LaunchDirectoryInfoAsync(new DirectoryInfo(path));
        };

        if (preferences is not null) RestoreWindow(preferences);

        SizeChanged += (_, e) => ApplyLayout(e.NewSize);
        UiScale.Changed += () => Dispatcher.UIThread.Post(() => ApplyLayout(new Size(Bounds.Width, Bounds.Height)));
        Opened += (_, _) => ApplyLayout(new Size(Bounds.Width, Bounds.Height));
        Closing += (_, _) => RememberWindow();
        KeyDown += OnKeyDown;
        ApplyLayout(new Size(Width, Height));
    }

    private void ApplyLayout(Size size)
    {
        if (size.Width < 1 || size.Height < 1) return;
        var layout = ResponsiveLayout.Apply(this, size);
        RootGrid.ColumnDefinitions[0].Width = new GridLength(layout.Sidebar);
        ScaleHost.LayoutTransform = Math.Abs(layout.Scale - 1) < 0.001 ? null : new ScaleTransform(layout.Scale, layout.Scale);
    }

    /// <summary>Ctrl/⌘ + plus, minus and 0 change the interface size, like a browser.</summary>
    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (!e.KeyModifiers.HasFlag(KeyModifiers.Control) && !e.KeyModifiers.HasFlag(KeyModifiers.Meta)) return;
        switch (e.Key)
        {
            case Key.OemPlus or Key.Add: UiScale.Step(+1); e.Handled = true; break;
            case Key.OemMinus or Key.Subtract: UiScale.Step(-1); e.Handled = true; break;
            case Key.D0 or Key.NumPad0: UiScale.Step(0); e.Handled = true; break;
        }
        if (e.Handled && _preferences is not null)
        {
            _preferences.UiScale = UiScale.Manual;
            _preferences.Save();
        }
    }

    private void RestoreWindow(AppSettings s)
    {
        var initial = ResponsiveLayout.InitialSize(this);
        Width = s.WindowWidth > 400 ? s.WindowWidth : initial.Width;
        Height = s.WindowHeight > 300 ? s.WindowHeight : initial.Height;
        if (s.Maximized) WindowState = WindowState.Maximized;
    }

    private void RememberWindow()
    {
        if (_preferences is null) return;
        _preferences.Maximized = WindowState == WindowState.Maximized;
        if (WindowState == WindowState.Normal)
        {
            _preferences.WindowWidth = Math.Round(Bounds.Width);
            _preferences.WindowHeight = Math.Round(Bounds.Height);
        }
        _preferences.Save();
    }
}
