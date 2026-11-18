using Avalonia;
using UniSlot.Desktop.Services;
using UniSlot.Desktop.ViewModels;

namespace UniSlot.Tests;

/// <summary>UiScale is process-wide state, so these tests must not run alongside each other.</summary>
[Collection("UiScale")]
public class ResponsiveTests : IDisposable
{
    public void Dispose() => UiScale.Set(0);

    [Theory]
    [InlineData(800, 600, 0.90)]    // small window: never below 0.9
    [InlineData(1366, 768, 1.00)]   // typical laptop: unscaled
    [InlineData(1920, 1080, 1.20)]  // full HD: grows
    [InlineData(2560, 1440, 1.35)]  // QHD: capped
    [InlineData(3840, 2160, 1.35)]
    public void Automatic_scale_follows_the_window_size(double width, double height, double expected)
    {
        UiScale.Set(0);
        Assert.InRange(UiScale.Resolve(new Size(width, height)), expected - 0.01, expected + 0.01);
    }

    [Fact]
    public void A_manual_scale_overrides_automatic_and_can_be_cleared()
    {
        UiScale.Set(1.4);
        Assert.Equal(1.4, UiScale.Resolve(new Size(800, 600)));
        Assert.Equal(1.4, UiScale.Resolve(new Size(3840, 2160)));
        UiScale.Set(0);
        Assert.NotEqual(1.4, UiScale.Resolve(new Size(800, 600)));
    }

    [Fact]
    public void Out_of_range_manual_values_are_clamped()
    {
        UiScale.Set(50);
        Assert.Equal(2.0, UiScale.Manual);
        UiScale.Set(0.1);
        Assert.Equal(0.7, UiScale.Manual);
    }

    [Fact]
    public void Keyboard_steps_move_through_the_scale_list_and_zero_returns_to_automatic()
    {
        UiScale.Set(0);
        UiScale.Resolve(new Size(1366, 768));            // current = 1.0
        UiScale.Step(+1);
        Assert.Equal(1.1, UiScale.Manual);
        UiScale.Resolve(new Size(1366, 768));
        UiScale.Step(+1);
        Assert.Equal(1.2, UiScale.Manual);
        UiScale.Resolve(new Size(1366, 768));
        UiScale.Step(-1);
        Assert.Equal(1.1, UiScale.Manual);
        UiScale.Step(0);
        Assert.Equal(0, UiScale.Manual);
    }

    [Fact]
    public void The_settings_page_follows_scale_changes_made_elsewhere_and_vice_versa()
    {
        UiScale.Set(0);
        var settings = new AppSettings();
        var vm = new SettingsViewModel(settings);
        Assert.Equal(0, vm.ScaleIndex);                  // automatic

        UiScale.Set(1.2);                                // for example Ctrl + plus
        Assert.Equal(3, vm.ScaleIndex);

        vm.ScaleIndex = 1;                               // "Small" chosen on the page
        Assert.Equal(0.9, UiScale.Manual);
        Assert.Equal(0.9, settings.UiScale);

        UiScale.Set(1.1);                                // a value with no button
        Assert.Equal(-1, vm.ScaleIndex);
    }
}

public class SettingsPersistenceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "unislot-settings-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    [Fact]
    public void A_plain_instance_never_writes_to_disk()
    {
        var s = new AppSettings { Language = "fr" };
        Assert.Null(s.PersistPath);
        s.Save();                                        // must be a harmless no-op
        Assert.False(Directory.Exists(_dir));
    }

    [Fact]
    public void Settings_round_trip_through_a_file()
    {
        string path = Path.Combine(_dir, "settings.json");
        var first = AppSettings.LoadFrom(path);
        first.Language = "ta";
        first.UiScale = 1.2;
        first.WindowWidth = 1400;
        first.Maximized = true;
        first.Save();

        var second = AppSettings.LoadFrom(path);
        Assert.Equal("ta", second.Language);
        Assert.Equal(1.2, second.UiScale);
        Assert.Equal(1400, second.WindowWidth);
        Assert.True(second.Maximized);
    }

    [Fact]
    public void A_corrupt_file_falls_back_to_defaults()
    {
        Directory.CreateDirectory(_dir);
        string path = Path.Combine(_dir, "settings.json");
        File.WriteAllText(path, "{ this is not json");
        var s = AppSettings.LoadFrom(path);
        Assert.Equal("en", s.Language);
        Assert.Equal(0, s.UiScale);
    }
}
