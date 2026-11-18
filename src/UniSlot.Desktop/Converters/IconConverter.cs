using System.Globalization;
using Avalonia.Data.Converters;

namespace UniSlot.Desktop.Converters;

/// <summary>Resolves an icon key (for example "IconUpload") to the theme's line-icon geometry.</summary>
public sealed class IconConverter : IValueConverter
{
    public static IconConverter Instance { get; } = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is string key && Avalonia.Application.Current is { } app && app.TryGetResource(key, null, out object? geometry) ? geometry : null;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}
