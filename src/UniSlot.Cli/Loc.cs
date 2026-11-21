using System.Globalization;
using System.Text.Json;

namespace UniSlot.Cli;

internal sealed record LanguageInfo(string Code, string NativeName);

/// <summary>
/// UI strings in six languages, embedded as JSON. A missing key falls back to English, then to the key itself,
/// so a half-translated language never shows blanks.
/// </summary>
internal static class Loc
{
    public static readonly IReadOnlyList<LanguageInfo> Languages =
    [
        new("en", "English"), new("hi", "हिन्दी"), new("ta", "தமிழ்"), new("es", "Español"), new("fr", "Français"), new("de", "Deutsch"),
    ];

    private static readonly Dictionary<string, Dictionary<string, string>> Tables = new(StringComparer.Ordinal);
    private static Dictionary<string, string> _english = Load("en");
    private static Dictionary<string, string> _current = _english;

    public static string Code { get; private set; } = "en";

    public static string T(string key) =>
        _current.TryGetValue(key, out string? v) ? v : _english.TryGetValue(key, out string? e) ? e : key;

    public static string F(string key, params object[] args) => string.Format(CultureInfo.CurrentCulture, T(key), args);

    /// <summary>Returns false (and keeps English) for an unknown code.</summary>
    public static bool Set(string? code)
    {
        code = (code ?? "en").Trim().ToLowerInvariant();
        bool known = Languages.Any(l => l.Code == code);
        if (!known) code = "en";
        Code = code;
        _current = code == "en" ? _english : Load(code);
        try { CultureInfo.CurrentCulture = CultureInfo.CurrentUICulture = new CultureInfo(code); }
        catch (CultureNotFoundException) { /* keep the current culture */ }
        return known;
    }

    public static IReadOnlyDictionary<string, string> Table(string code) => Load(code);

    private static Dictionary<string, string> Load(string code)
    {
        lock (Tables)
        {
            if (Tables.TryGetValue(code, out var cached)) return cached;
            var table = new Dictionary<string, string>(StringComparer.Ordinal);
            using var stream = typeof(Loc).Assembly.GetManifestResourceStream($"UniSlot.Cli.Strings.{code}.json");
            if (stream is not null)
                using (var doc = JsonDocument.Parse(stream))
                    foreach (var p in doc.RootElement.EnumerateObject())
                        table[p.Name] = p.Value.GetString() ?? "";
            Tables[code] = table;
            return table;
        }
    }
}
