using System.Text;
using System.Text.Json;
using ClosedXML.Excel;
using UniSlot.Application.Workflow;

namespace UniSlot.Infrastructure.Export;

public static class OutputWriter
{
    public const string ScheduleFile = "schedule.xlsx";
    public const string ClashFile = "clash-report.xlsx";
    public const string EmailsFile = "course-emails.xlsx";
    public const string SnapshotFile = "snapshot.json";
    public const string SummaryFile = "summary.json";

    /// <summary>Writes the five-file output folder. Files are written to temporary names first, so a failure never leaves a half-written folder.</summary>
    public static async Task<IReadOnlyList<string>> WriteAsync(SolveOutcome outcome, string directory, ExportOptions? options = null, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(outcome);
        options ??= new ExportOptions();
        Directory.CreateDirectory(directory);
        var at = DateTimeOffset.UtcNow;

        var jobs = new (string Name, Func<byte[]> Render)[]
        {
            (ScheduleFile, () => Render(ScheduleWorkbook.Build(outcome, options))),
            (ClashFile, () => Render(ClashWorkbook.Build(outcome, options))),
            (EmailsFile, () => Render(EmailsWorkbook.Build(outcome, options))),
            (SnapshotFile, () => Encoding.UTF8.GetBytes(SnapshotJson.Build(outcome, at).ToJsonString(SnapshotJson.Options))),
            (SummaryFile, () => Encoding.UTF8.GetBytes(SummaryJson.Build(outcome).ToJsonString(SnapshotJson.Options))),
        };

        var rendered = await Task.WhenAll(jobs.Select(j => Task.Run(() => (j.Name, Bytes: j.Render()), ct))).ConfigureAwait(false);

        var temp = rendered.Select(r => (r.Name, Temp: Path.Combine(directory, r.Name + ".tmp"), r.Bytes)).ToList();
        try
        {
            foreach (var t in temp) await File.WriteAllBytesAsync(t.Temp, t.Bytes, ct).ConfigureAwait(false);
            foreach (var t in temp) File.Move(t.Temp, Path.Combine(directory, t.Name), overwrite: true);
        }
        finally
        {
            foreach (var t in temp) if (File.Exists(t.Temp)) File.Delete(t.Temp);
        }
        return [.. temp.Select(t => Path.Combine(directory, t.Name))];
    }

    private static byte[] Render(XLWorkbook workbook)
    {
        using (workbook)
        using (var ms = new MemoryStream())
        {
            workbook.SaveAs(ms);
            return ms.ToArray();
        }
    }
}
