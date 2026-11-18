using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Platform.Storage;
using UniSlot.Desktop.ViewModels;

namespace UniSlot.Desktop.Views;

public partial class SolveView : UserControl
{
    public SolveView()
    {
        InitializeComponent();
        AddHandler(DragDrop.DragOverEvent, OnDragOver);
        AddHandler(DragDrop.DropEvent, OnDrop);
        SizeChanged += (_, e) => Adapt(e.NewSize.Width);
    }

    /// <summary>The page always stays a single stacked column (file, options, action), even on large screens; the quality choices stack when very narrow.</summary>
    private void Adapt(double width)
    {
        _narrow = width < 640;
        ApplyQualityColumns();
    }

    private bool _narrow;

    /// <summary>The items panel is created by the list's template, so it is reached through the list rather than by name.</summary>
    private void ApplyQualityColumns()
    {
        if (QualityList.ItemsPanelRoot is UniformGrid grid) grid.Columns = _narrow ? 1 : 3;
    }

    protected override void OnLoaded(Avalonia.Interactivity.RoutedEventArgs e)
    {
        base.OnLoaded(e);
        ApplyQualityColumns();
    }

    private static void OnDragOver(object? sender, DragEventArgs e) =>
        e.DragEffects = e.DataTransfer.Contains(DataFormat.File) ? DragDropEffects.Copy : DragDropEffects.None;

    private void OnDrop(object? sender, DragEventArgs e)
    {
        var path = e.DataTransfer.TryGetFiles()?.Select(f => f.TryGetLocalPath())
            .FirstOrDefault(p => p is not null && (p.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) || p.EndsWith(".xlsm", StringComparison.OrdinalIgnoreCase)));
        if (path is not null && DataContext is SolveViewModel vm) vm.SetFile(path);
        e.Handled = true;
    }
}
