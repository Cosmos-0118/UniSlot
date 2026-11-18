using ClosedXML.Excel;

namespace UniSlot.Infrastructure.Export;

/// <summary>Neutral, high-contrast workbook styling shared by every export.</summary>
internal static class Styling
{
    public static readonly XLColor Ink = XLColor.FromHtml("#0A0A0A");
    public static readonly XLColor Muted = XLColor.FromHtml("#666666");
    public static readonly XLColor Border = XLColor.FromHtml("#EAEAEA");
    public static readonly XLColor Zebra = XLColor.FromHtml("#FAFAFA");
    public static readonly XLColor Band = XLColor.FromHtml("#F1F1F1");
    public static readonly XLColor RedFill = XLColor.FromHtml("#FEE2E2");
    public static readonly XLColor RedText = XLColor.FromHtml("#B91C1C");
    public static readonly XLColor GreenFill = XLColor.FromHtml("#DCFCE7");
    public static readonly XLColor GreenText = XLColor.FromHtml("#15803D");

    public const string AppName = "UniSlot";

    /// <summary>Writes rows 1–3: product (+ institution), sheet heading, blank spacer. Tables then start at row 4.</summary>
    public static void TitleBlock(IXLWorksheet ws, ExportOptions options, string heading, int columns)
    {
        string brand = string.IsNullOrWhiteSpace(options.Institution) ? AppName : $"{AppName} · {options.Institution.Trim()}";
        ws.Cell(1, 1).Value = brand;
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 14;
        ws.Cell(1, 1).Style.Font.FontColor = Ink;
        ws.Cell(2, 1).Value = heading;
        ws.Cell(2, 1).Style.Font.Bold = true;
        ws.Cell(2, 1).Style.Font.FontSize = 10;
        ws.Cell(2, 1).Style.Font.FontColor = Muted;
        ws.Range(1, 1, 1, columns).Merge();
        ws.Range(2, 1, 2, columns).Merge();
    }

    public static void Header(IXLWorksheet ws, int row, params string[] headers)
    {
        for (int i = 0; i < headers.Length; i++) ws.Cell(row, i + 1).Value = headers[i];
        var range = ws.Range(row, 1, row, headers.Length);
        range.Style.Font.Bold = true;
        range.Style.Font.FontColor = XLColor.White;
        range.Style.Fill.BackgroundColor = Ink;
        range.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        ws.Row(row).Height = 22;
    }

    /// <summary>Applies a hairline border and zebra striping to a body block.</summary>
    public static void Body(IXLWorksheet ws, int firstRow, int lastRow, int columns)
    {
        if (lastRow < firstRow) return;
        var body = ws.Range(firstRow, 1, lastRow, columns);
        body.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        body.Style.Border.InsideBorderColor = Border;
        body.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        body.Style.Border.OutsideBorderColor = Border;
        body.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
        for (int r = firstRow; r <= lastRow; r += 2) ws.Range(r, 1, r, columns).Style.Fill.BackgroundColor = Zebra;
    }

    public static void Widths(IXLWorksheet ws, params double[] widths)
    {
        for (int i = 0; i < widths.Length; i++) ws.Column(i + 1).Width = widths[i];
    }

    public static void Set(IXLCell cell, object? value) => cell.Value = XLCellValue.FromObject(value);

    public static string SafeSheet(string name) => name.Length <= 31 ? name : name[..31];
}

public sealed record ExportOptions
{
    /// <summary>Shown in workbook headers next to the product name (for example a university). Optional.</summary>
    public string? Institution { get; init; }
}
