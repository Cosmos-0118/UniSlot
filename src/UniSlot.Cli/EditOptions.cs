using System.Globalization;
using UniSlot.Application.Editing;

namespace UniSlot.Cli;

/// <summary>Command-line options shared by the maintenance commands (<c>late</c>, <c>rectify</c>, <c>fix-course</c>, <c>drop-course</c>, <c>revert</c>, <c>name-list</c>, <c>filter</c>, <c>issues</c>).</summary>
internal sealed record EditOptions
{
    public const string Late = "late", Rectify = "rectify", FixCourse = "fix-course", DropCourse = "drop-course", Revert = "revert",
        NameList = "name-list", Filter = "filter", Issues = "issues";

    public static readonly string[] Modes = [Late, Rectify, FixCourse, DropCourse, Revert, NameList, Filter, Issues];

    public required string Mode { get; init; }
    public string? Previous { get; init; }
    public string? Edited { get; init; }
    public string? Folder { get; init; }
    public string? LateFile { get; init; }
    public string? RectifiedFile { get; init; }
    public string? Input { get; init; }
    public string? Output { get; init; }
    public string[] Registers { get; init; } = [];
    public string[] Courses { get; init; } = [];
    public string? From { get; init; }
    public string? To { get; init; }
    public string? ToTitle { get; init; }
    public bool All { get; init; }
    public FullPolicy OnFull { get; init; } = FullPolicy.NewSection;
    public ClashPolicy OnClash { get; init; } = ClashPolicy.Accept;
    /// <summary>Whether <c>--on-full</c> / <c>--on-clash</c> were given, so an interactive run does not ask again.</summary>
    public bool OnFullGiven { get; init; }
    public bool OnClashGiven { get; init; }
    public string? Institution { get; init; }
    public bool Quiet { get; init; }
    public bool Yes { get; init; }
    /// <summary>Options from the original tool that have no effect here; accepted so old scripts keep running.</summary>
    public string[] Ignored { get; init; } = [];
    public string? Lang { get; init; }
    public string[] Show { get; init; } = [];
    public int Limit { get; init; } = 40;

    public static EditOptions Parse(string mode, string[] a)
    {
        var o = new EditOptions { Mode = mode };
        for (int i = 0; i < a.Length; i++)
        {
            string Next() => ++i < a.Length ? a[i] : throw new ArgumentException($"Option '{a[i - 1]}' needs a value.");
            string[] List() => Next().Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            switch (a[i])
            {
                case "--previous": o = o with { Previous = Next() }; break;
                case "--baseline": Next(); break;   // the original tool needed the old workbook; the saved folder already holds it
                case "--edited": o = o with { Edited = Next() }; break;
                case "--folder": o = o with { Folder = Next() }; break;
                case "--late": o = o with { LateFile = Next() }; break;
                case "--rectified": o = o with { RectifiedFile = Next() }; break;
                case "-i" or "--input": o = o with { Input = Next() }; break;
                case "-o" or "--output": o = o with { Output = Next() }; break;
                case "--register": o = o with { Registers = List() }; break;
                case "--course" or "--courses" or "--codes" or "-c": o = o with { Courses = [.. List().Select(c => c.ToUpperInvariant())] }; break;
                case "--from": o = o with { From = Next().Trim().ToUpperInvariant() }; break;
                case "--to": o = o with { To = Next().Trim().ToUpperInvariant() }; break;
                case "--to-title": o = o with { ToTitle = Next() }; break;
                case "--all": o = o with { All = true }; break;
                case "--nomenclature" or "--workers" or "--threads" or "--time-limit" or "--seed" or "--absolute-gap" or "--prove-plateau" or "--prove-strategy"
                    or "--portfolio" or "--overflow-buffer" or "--saturday-codes":
                    o = o with { Ignored = [.. o.Ignored, a[i]] };
                    Next();
                    break;
                case "--prove" or "--saturday" or "--no-saturday":
                    o = o with { Ignored = [.. o.Ignored, a[i]] };
                    break;
                case "--on-full":
                    o = o with
                    {
                        OnFullGiven = true,
                        OnFull = Next().ToLowerInvariant() switch
                        {
                            "new-section" => FullPolicy.NewSection,
                            "fit" => FullPolicy.Fit,
                            "park" => FullPolicy.Park,
                            "equalize" or "buffer" => throw new ArgumentException("--on-full equalize and buffer are not available in this version. Use new-section, fit or park."),
                            _ => throw new ArgumentException("--on-full must be new-section, fit or park."),
                        },
                    };
                    break;
                case "--on-clash":
                    o = o with
                    {
                        OnClashGiven = true,
                        OnClash = Next().ToLowerInvariant() switch
                        {
                            "accept" => ClashPolicy.Accept,
                            "park-student" => ClashPolicy.ParkStudent,
                            "drop-course" => throw new ArgumentException("--on-clash drop-course is not available in this version. Use accept or park-student, or run drop-course afterwards."),
                            _ => throw new ArgumentException("--on-clash must be accept or park-student."),
                        },
                    };
                    break;
                case "--institution": o = o with { Institution = Next() }; break;
                case "-q" or "--quiet": o = o with { Quiet = true }; break;
                case "-y" or "--yes": o = o with { Yes = true }; break;
                case "--lang": o = o with { Lang = Next() }; break;
                case "--show":
                    o = o with { Show = [.. Next().ToLowerInvariant().Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries).Select(s => s is "schedule" or "clashes" ? s : throw new ArgumentException("--show takes schedule and/or clashes."))] };
                    break;
                case "--limit": o = o with { Limit = int.TryParse(Next(), CultureInfo.InvariantCulture, out var l) && l >= 0 ? l : throw new ArgumentException("--limit must be a non-negative integer.") }; break;
                default: throw new ArgumentException($"Unknown option '{a[i]}'.");
            }
        }
        return o;
    }

    /// <summary>Every option the command cannot run without, as a user-facing message.</summary>
    public void Require()
    {
        void Need(string? value, string option) { if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"Missing {option}."); }
        switch (Mode)
        {
            case Late: Need(Previous, "--previous <output folder>"); Need(LateFile, "--late <workbook.xlsx>"); break;
            case Rectify: Need(Previous, "--previous <output folder>"); Need(RectifiedFile, "--rectified <workbook.xlsx>"); break;
            case FixCourse:
                Need(Previous, "--previous <output folder>"); Need(From, "--from <wrong course code>"); Need(To, "--to <correct course code>");
                if (Registers.Length != 1) throw new ArgumentException("Missing --register <register number> (exactly one).");
                break;
            case DropCourse:
                Need(Previous, "--previous <output folder>");
                if (Registers.Length != 1) throw new ArgumentException("Missing --register <register number> (exactly one).");
                if (Courses.Length != 1) throw new ArgumentException("Missing --course <course code> (exactly one).");
                break;
            case Revert:
                Need(Edited, "--edited <folder with the mistake>"); Need(Previous, "--previous <folder from before the mistake>");
                if (!All && Registers.Length == 0 && Courses.Length == 0) throw new ArgumentException("Choose what to restore: --register <list>, --course <list> or --all.");
                break;
            case NameList: Need(SourceFolder, "--folder <output folder>"); break;
            case Filter: Need(SourceFolder, "--folder <output folder>"); if (Courses.Length == 0) throw new ArgumentException("Missing --courses <code list>."); break;
            case Issues: Need(Input, "-i <enrollment.xlsx>"); break;
        }
    }

    /// <summary>The output folder the command works on: <c>--folder</c>, or <c>-i</c> given as a folder or as a file inside one (as the original filter command took schedule.xlsx).</summary>
    public string? SourceFolder => Folder ?? (string.IsNullOrWhiteSpace(Input) ? null : Directory.Exists(Input) ? Input : Path.GetDirectoryName(Path.GetFullPath(Input)));

    public string DefaultOutput => Output ?? Mode switch
    {
        Filter => "unislot-filtered",
        NameList => SourceFolder!,
        Rectify => "unislot-out-rectified",
        FixCourse or DropCourse => "unislot-out-fix",
        _ => $"unislot-out-{Mode}",
    };

    /// <summary>True when the options already name everything the command needs (so it can run without questions).</summary>
    public bool IsComplete
    {
        get
        {
            try { Require(); return true; }
            catch (ArgumentException) { return false; }
        }
    }
}
