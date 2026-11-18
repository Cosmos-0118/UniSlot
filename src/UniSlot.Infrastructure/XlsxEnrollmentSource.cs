using System.Globalization;
using System.Security.Cryptography;
using ClosedXML.Excel;
using UniSlot.Application.Workflow;

namespace UniSlot.Infrastructure;

/// <summary>Reads the first worksheet of an enrollment workbook into a plain grid of strings plus a fingerprint of the file.</summary>
public static class XlsxEnrollmentSource
{
    public static async Task<SolveInput> ReadAsync(string path, CancellationToken ct = default)
    {
        byte[] bytes = await File.ReadAllBytesAsync(path, ct).ConfigureAwait(false);
        string hash = Convert.ToHexStringLower(SHA256.HashData(bytes));
        var source = new SourceInfo(Path.GetFileName(path), bytes.LongLength, hash);
        var grid = await Task.Run(() => ReadGrid(bytes), ct).ConfigureAwait(false);
        return new SolveInput(source, grid);
    }

    public static IReadOnlyList<IReadOnlyList<string?>> ReadGrid(byte[] workbookBytes)
    {
        using var stream = new MemoryStream(workbookBytes, writable: false);
        using var workbook = new XLWorkbook(stream);
        var sheet = workbook.Worksheets.FirstOrDefault() ?? throw new InvalidDataException("The workbook has no worksheets.");

        var lastRow = sheet.LastRowUsed()?.RowNumber() ?? 0;
        var lastColumn = sheet.LastColumnUsed()?.ColumnNumber() ?? 0;
        var grid = new List<IReadOnlyList<string?>>(lastRow);
        for (int r = 1; r <= lastRow; r++)
        {
            var row = new string?[lastColumn];
            for (int c = 1; c <= lastColumn; c++) row[c - 1] = Text(sheet.Cell(r, c));
            grid.Add(row);
        }
        return grid;
    }

    private static string? Text(IXLCell cell)
    {
        var v = cell.Value;
        if (v.IsBlank) return null;
        if (v.IsText) return v.GetText();
        if (v.IsNumber)
        {
            double d = v.GetNumber();
            return d == Math.Floor(d) && Math.Abs(d) < 1e15 ? ((long)d).ToString(CultureInfo.InvariantCulture) : d.ToString("R", CultureInfo.InvariantCulture);
        }
        if (v.IsBoolean) return v.GetBoolean() ? "TRUE" : "FALSE";
        if (v.IsDateTime) return v.GetDateTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (v.IsTimeSpan) return v.GetTimeSpan().ToString();
        return v.ToString(CultureInfo.InvariantCulture);
    }
}
