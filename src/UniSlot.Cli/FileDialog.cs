using System.ComponentModel;
using System.Diagnostics;
using System.Text;

namespace UniSlot.Cli;

/// <summary>
/// The operating system's own file and folder dialogs, as the original tool offered: Windows Forms on Windows, <c>osascript</c> on macOS,
/// <c>zenity</c> on Linux. Every method returns null when the dialog is cancelled or cannot be shown, so callers fall back to typing a path.
/// </summary>
internal static class FileDialog
{
    /// <summary>Set to false (or define <c>UNISLOT_NO_DIALOG</c>) to never open a dialog.</summary>
    public static bool Enabled { get; set; } = Environment.GetEnvironmentVariable("UNISLOT_NO_DIALOG") is null;

    public static bool Available =>
        Enabled && !Console.IsInputRedirected && !Console.IsOutputRedirected
        && (OperatingSystem.IsWindows() || OperatingSystem.IsMacOS() || (OperatingSystem.IsLinux() && OnPath("zenity")));

    public static string? PickFile(string title)
    {
        if (!Available) return null;
        if (OperatingSystem.IsWindows())
            return Windows($$"""
                $dialog = New-Object System.Windows.Forms.OpenFileDialog
                $dialog.Filter = 'Excel (*.xlsx)|*.xlsx|All files (*.*)|*.*'
                $dialog.Title = {{Quote(title)}}
                $dialog.Multiselect = $false
                $dialog.CheckFileExists = $true
                {{OwnerOpen}}
                $result = $dialog.ShowDialog($owner)
                {{OwnerClose}}
                if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }
                """);
        if (OperatingSystem.IsMacOS())
            return Run("osascript", ["-e", $"POSIX path of (choose file with prompt \"{Escape(title)}\" of type {{\"org.openxmlformats.spreadsheetml.sheet\", \"public.data\"}})"]);
        return Run("zenity", ["--file-selection", $"--title={title}", "--file-filter=Excel | *.xlsx *.XLSX"]);
    }

    public static string? PickFolder(string title)
    {
        if (!Available) return null;
        if (OperatingSystem.IsWindows())
            return Windows($$"""
                $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
                $dialog.Description = {{Quote(title)}}
                $dialog.ShowNewFolderButton = $true
                {{OwnerOpen}}
                $result = $dialog.ShowDialog($owner)
                {{OwnerClose}}
                if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }
                """);
        if (OperatingSystem.IsMacOS())
            return Run("osascript", ["-e", $"POSIX path of (choose folder with prompt \"{Escape(title)}\")"]);
        return Run("zenity", ["--file-selection", $"--title={title}", "--directory"]);
    }

    // Windows Forms dialogs need an STA thread, UTF-8 output and a TopMost owner so the dialog is not hidden behind the terminal.
    private const string OwnerOpen = """
        $owner = New-Object System.Windows.Forms.Form
        $owner.TopMost = $true
        $owner.ShowInTaskbar = $false
        $owner.WindowState = 'Minimized'
        $owner.FormBorderStyle = 'FixedToolWindow'
        $owner.Width = 1
        $owner.Height = 1
        $null = $owner.Show()
        $owner.Activate()
        """;

    private const string OwnerClose = """
        $owner.Close()
        $owner.Dispose()
        """;

    private static string? Windows(string body)
    {
        string script = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false\n$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName System.Windows.Forms\n" + body;
        string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        return Run("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded]);
    }

    private static string Quote(string s) => "'" + s.Replace("'", "''", StringComparison.Ordinal) + "'";

    private static string Escape(string s) => s.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal);

    private static string? Run(string exe, IEnumerable<string> args)
    {
        var info = new ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
        };
        foreach (string a in args) info.ArgumentList.Add(a);
        try
        {
            using var process = Process.Start(info);
            if (process is null) return null;
            process.ErrorDataReceived += (_, _) => { /* discarded: cancelling a dialog is not an error */ };
            process.BeginErrorReadLine();
            string output = process.StandardOutput.ReadToEnd();
            process.WaitForExit();
            if (process.ExitCode != 0) return null;
            return output.Split('\n').Select(s => s.Trim()).FirstOrDefault(s => s.Length > 0);
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException)
        {
            return null;
        }
    }

    private static bool OnPath(string command) =>
        (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Any(dir => File.Exists(Path.Combine(dir, command)));
}
