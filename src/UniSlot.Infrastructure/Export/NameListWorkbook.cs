using ClosedXML.Excel;
using UniSlot.Domain;

namespace UniSlot.Infrastructure.Export;

/// <summary>Rebuilds the enrollment sheet in the input layout from a saved schedule, so it can be used as the next run's input.</summary>
public static class NameListWorkbook
{
    public static XLWorkbook Build(IReadOnlyList<EnrollmentRow> rows)
    {
        bool registration = rows.Any(r => !string.IsNullOrWhiteSpace(r.RegistrationType));
        bool remarks = rows.Any(r => !string.IsNullOrWhiteSpace(r.Remarks));
        bool adl = rows.Any(r => !string.IsNullOrWhiteSpace(r.AdditionalRemarks));

        var headers = new List<string> { "Program", "Register Number", "Student Name", "Mobile Number", "Email ID", "Course Code", "Course Title", "Faculty" };
        if (registration) headers.Add("Registration Type");
        if (remarks) headers.Add("Remarks");
        if (adl) headers.Add("ADL Remarks");

        var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Name List");
        for (int c = 0; c < headers.Count; c++)
        {
            var cell = ws.Cell(1, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#E8EEF9");
        }
        int r = 2;
        foreach (var row in rows)
        {
            var values = new List<string?> { row.Program, row.RegisterNumber, row.StudentName, row.Mobile, row.Email, row.CourseCode, row.CourseTitle, row.Faculty };
            if (registration) values.Add(row.RegistrationType);
            if (remarks) values.Add(row.Remarks);
            if (adl) values.Add(row.AdditionalRemarks);
            for (int c = 0; c < values.Count; c++)
                if (!string.IsNullOrEmpty(values[c])) ws.Cell(r, c + 1).SetValue(values[c]!);
            r++;
        }
        ws.SheetView.FreezeRows(1);
        ws.Columns().AdjustToContents(1, Math.Min(r, 200));
        return wb;
    }
}
