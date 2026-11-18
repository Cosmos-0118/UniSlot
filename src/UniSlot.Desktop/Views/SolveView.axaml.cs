using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Platform.Storage;
using UniSlot.Desktop.ViewModels;

namespace UniSlot.Desktop.Views;

public partial class SolveView : UserControl
{
    private bool? _wide;

    public SolveView()
    {
        InitializeComponent();
        AddHandler(DragDrop.DragOverEvent, OnDragOver);
        AddHandler(DragDrop.DropEvent, OnDrop);
        SizeChanged += (_, e) => Adapt(e.NewSize.Width);
    }

    /// <summary>Two columns (inputs left, options right) when there is room, one column otherwise; the quality choices stack when very narrow.</summary>
    private void Adapt(double width)
    {
        bool wide = width >= 1080;
        if (_wide != wide)
        {
            _wide = wide;
            PageGrid.ColumnDefinitions = new ColumnDefinitions(wide ? "*,28,400" : "*");
            // the star row absorbs the height of the tall options card so the action buttons stay directly under the file card
            PageGrid.RowDefinitions = new RowDefinitions(wide ? "Auto,Auto,*,Auto" : "Auto,Auto,Auto,Auto");
            Grid.SetColumnSpan(HeaderPanel, wide ? 3 : 1);
            Grid.SetRow(TopPanel, 1);
            Grid.SetColumn(TopPanel, 0);
            Grid.SetRow(OptionsCard, wide ? 1 : 2);
            Grid.SetColumn(OptionsCard, wide ? 2 : 0);
            Grid.SetRowSpan(OptionsCard, wide ? 2 : 1);
            Grid.SetRow(BottomPanel, wide ? 2 : 3);
            Grid.SetColumn(BottomPanel, 0);
        }
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
