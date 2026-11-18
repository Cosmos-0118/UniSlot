using System.ComponentModel;
using System.Globalization;
using System.Text.Json;
using Avalonia.Data;
using Avalonia.Markup.Xaml;

namespace UniSlot.Desktop.Services;

public sealed record LanguageInfo(string Code, string NativeName);

/// <summary>
/// Runtime-switchable UI strings. Languages are embedded JSON dictionaries; a missing key falls back to English, then to the key itself,
/// so a half-translated language never shows blanks. Bindings use the indexer so the whole UI updates when the language changes.
/// </summary>
public sealed class Loc : INotifyPropertyChanged
{
    public static Loc Instance { get; } = new();

    public static readonly IReadOnlyList<LanguageInfo> Languages =
    [
        new("en", "English"), new("hi", "हिन्दी"), new("ta", "தமிழ்"), new("es", "Español"), new("fr", "Français"), new("de", "Deutsch"),
    ];

    private readonly Dictionary<string, Dictionary<string, string>> _tables = new(StringComparer.Ordinal);
    private Dictionary<string, string> _current = new();
    private readonly Dictionary<string, string> _english;

    private Loc()
    {
        _english = Load("en");
        _current = _english;
        Code = "en";
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public string Code { get; private set; }

    public string this[string key] =>
        _current.TryGetValue(key, out string? v) ? v : _english.TryGetValue(key, out string? e) ? e : key;

    public string Format(string key, params object[] args) => string.Format(CultureInfo.CurrentCulture, this[key], args);

    public void SetLanguage(string code)
    {
        if (Languages.All(l => l.Code != code)) code = "en";
        Code = code;
        _current = code == "en" ? _english : Load(code);
        try { CultureInfo.CurrentCulture = CultureInfo.CurrentUICulture = new CultureInfo(code); }
        catch (CultureNotFoundException) { /* keep the current culture */ }
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("Item[]"));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Code)));
    }

    private Dictionary<string, string> Load(string code)
    {
        if (_tables.TryGetValue(code, out var cached)) return cached;
        var table = new Dictionary<string, string>(StringComparer.Ordinal);
        using var stream = typeof(Loc).Assembly.GetManifestResourceStream($"UniSlot.Desktop.Resources.Strings.{code}.json");
        if (stream is not null)
            foreach (var p in JsonDocument.Parse(stream).RootElement.EnumerateObject())
                table[p.Name] = p.Value.GetString() ?? "";
        _tables[code] = table;
        return table;
    }

    public static string T(string key) => Instance[key];
}

/// <summary><c>{loc:T key}</c> — a live binding to the current language's string.</summary>
public sealed class TExtension(string key) : MarkupExtension
{
    public string Key { get; set; } = key;

    public override object ProvideValue(IServiceProvider serviceProvider) =>
        new Binding($"[{Key}]") { Source = Loc.Instance, Mode = BindingMode.OneWay };
}
