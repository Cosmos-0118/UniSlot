namespace UniSlot.Desktop.Services;

/// <summary>Window-bound capabilities (file picker, opening folders) injected by the main window so view models stay UI-free.</summary>
public static class Shell
{
    public static Func<Task<string?>> PickWorkbook { get; set; } = () => Task.FromResult<string?>(null);
    public static Action<string> OpenFolder { get; set; } = _ => { };
}
