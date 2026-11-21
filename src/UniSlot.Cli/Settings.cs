using System.Text.Json;

namespace UniSlot.Cli;

/// <summary>
/// User preferences as JSON, in the same file and with the same property names earlier UniSlot releases used, so existing
/// preferences carry over. An instance only writes to disk when it was loaded from a file; <c>new CliSettings()</c> is in-memory.
/// Corrupt or missing files fall back to defaults.
/// </summary>
internal sealed class CliSettings
{
    public string Language { get; set; } = "en";
    public string Institution { get; set; } = "";
    public string OutputRoot { get; set; } = DefaultOutputRoot();
    public long Seed { get; set; } = 1;
    /// <summary>0 = quick, 1 = standard, 2 = thorough.</summary>
    public int Quality { get; set; } = 1;
    public bool AllowSaturday { get; set; }
    public string SaturdayCodes { get; set; } = "";
    public bool Prove { get; set; }
    public string LastFile { get; set; } = "";

    [System.Text.Json.Serialization.JsonIgnore]
    public string? PersistPath { get; private set; }

    public static string DefaultOutputRoot() => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "UniSlot");

    public static string DefaultPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "UniSlot", "settings.json");

    public static CliSettings Load() => LoadFrom(DefaultPath);

    public static CliSettings LoadFrom(string path)
    {
        CliSettings? loaded = null;
        try
        {
            if (File.Exists(path))
                loaded = JsonSerializer.Deserialize<CliSettings>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { /* use defaults */ }
        loaded ??= new CliSettings();
        loaded.Quality = Math.Clamp(loaded.Quality, 0, 2);
        if (loaded.Seed < 0) loaded.Seed = 1;
        if (string.IsNullOrWhiteSpace(loaded.OutputRoot)) loaded.OutputRoot = DefaultOutputRoot();
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
