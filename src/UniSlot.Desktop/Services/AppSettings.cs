using System.Text.Json;
using System.Text.Json.Serialization;

namespace UniSlot.Desktop.Services;

/// <summary>
/// User preferences stored as JSON. An instance only writes to disk when it was loaded from a file (<see cref="Load"/> or
/// <see cref="LoadFrom"/>); a plain <c>new AppSettings()</c> is purely in-memory, so tests and tools can never overwrite a real profile.
/// Corrupt or missing files fall back to defaults.
/// </summary>
public sealed class AppSettings
{
    public string Language { get; set; } = "en";
    /// <summary>"system", "light" or "dark".</summary>
    public string Theme { get; set; } = "system";
    public string Institution { get; set; } = "";
    public string OutputRoot { get; set; } = DefaultOutputRoot();
    public long Seed { get; set; } = 1;
    /// <summary>0 = quick, 1 = standard, 2 = thorough.</summary>
    public int Quality { get; set; } = 1;
    public bool AllowSaturday { get; set; }
    public bool Prove { get; set; }
    /// <summary>0 = automatic; otherwise a fixed interface scale such as 1.2.</summary>
    public double UiScale { get; set; }
    public double WindowWidth { get; set; }
    public double WindowHeight { get; set; }
    public bool Maximized { get; set; }

    /// <summary>Where <see cref="Save"/> writes. Null means in-memory only.</summary>
    [JsonIgnore]
    public string? PersistPath { get; private set; }

    public static string DefaultOutputRoot() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "UniSlot");

    public static string DefaultPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "UniSlot", "settings.json");

    /// <summary>Loads the user's settings from the standard location.</summary>
    public static AppSettings Load() => LoadFrom(DefaultPath);

    public static AppSettings LoadFrom(string path)
    {
        AppSettings? loaded = null;
        try
        {
            if (File.Exists(path)) loaded = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path));
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { /* use defaults */ }
        loaded ??= new AppSettings();
        loaded.PersistPath = path;
        return loaded;
    }

    public void Save()
    {
        if (PersistPath is null) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(PersistPath)!);
            File.WriteAllText(PersistPath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* preferences are best-effort */ }
    }
}
