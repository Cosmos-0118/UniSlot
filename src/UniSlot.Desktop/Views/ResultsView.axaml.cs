using Avalonia.Controls;

namespace UniSlot.Desktop.Views;

public partial class ResultsView : UserControl
{
    public ResultsView()
    {
        InitializeComponent();
        // headline cards: four across when roomy, two on medium widths, stacked when narrow
        SizeChanged += (_, e) => Cards.Columns = e.NewSize.Width >= 1000 ? 4 : e.NewSize.Width >= 640 ? 2 : 1;
    }
}
