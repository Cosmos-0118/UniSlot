using System.Globalization;

namespace UniSlot.Cli;

/// <summary>Command-line options for <c>unislot solve</c>. Parsing is pure; file checks are done by the caller.</summary>
internal sealed record Options
{
    public string Input { get; init; } = "";
    public bool Yes { get; init; }
    /// <summary>Options from the original tool that have no counterpart in this engine; accepted so old scripts keep running.</summary>
    public string[] Ignored { get; init; } = [];
    public string? Output { get; init; }
    public ulong? Seed { get; init; }
    public long? Moves { get; init; }
    public int Chains { get; init; } = 12;
    public TimeSpan? TimeLimit { get; init; }
    public int? Threads { get; init; }
    public bool? Saturday { get; init; }
    public string[]? SaturdayCodes { get; init; }
    public bool? Prove { get; init; }
    public TimeSpan? ProveTime { get; init; }
    public string? Institution { get; init; }
    public bool Verify { get; init; }
    public bool Quiet { get; init; }
    public string? Lang { get; init; }
    public string[] Show { get; init; } = [];
    public int Limit { get; init; } = 40;

    public const long Quick = 6_000_000, Standard = 30_000_000, Thorough = 150_000_000;

    public static Options Parse(string[] a)
    {
        var o = new Options();
        for (int i = 0; i < a.Length; i++)
        {
            string Next() => ++i < a.Length ? a[i] : throw new ArgumentException($"Option '{a[i - 1]}' needs a value.");
            switch (a[i])
            {
                case "-i" or "--input": o = o with { Input = Next() }; break;
                case "-o" or "--output": o = o with { Output = Next() }; break;
                case "--seed": o = ApplySeed(o, Next()); break;
                case "-y" or "--yes": o = o with { Yes = true }; break;
                case "--no-saturday": o = o with { Saturday = false }; break;
                case "--workers": o = o with { Threads = int.TryParse(Next(), CultureInfo.InvariantCulture, out var w) && w > 0 ? w : throw new ArgumentException("--workers must be a positive integer.") }; break;
                case "--time-limit": o = o with { TimeLimit = double.TryParse(Next(), CultureInfo.InvariantCulture, out var tl) && tl > 0 ? TimeSpan.FromSeconds(tl) : throw new ArgumentException("--time-limit must be a positive number of seconds.") }; break;
                case "--portfolio" or "--absolute-gap" or "--prove-plateau" or "--prove-strategy" or "--nomenclature":
                    o = o with { Ignored = [.. o.Ignored, a[i]] };
                    Next();
                    break;
                case "--preset":
                    o = o with
                    {
                        Moves = Next().ToLowerInvariant() switch
                        {
                            "quick" => Quick,
                            "standard" => Standard,
                            "thorough" => Thorough,
                            _ => throw new ArgumentException("--preset must be quick, standard or thorough."),
                        },
                    };
                    break;
                case "--moves": o = o with { Moves = long.TryParse(Next(), CultureInfo.InvariantCulture, out var m) && m > 0 ? m : throw new ArgumentException("--moves must be a positive integer.") }; break;
                case "--chains": o = o with { Chains = int.TryParse(Next(), CultureInfo.InvariantCulture, out var c) && c > 0 ? c : throw new ArgumentException("--chains must be a positive integer.") }; break;
                case "--time": o = o with { TimeLimit = double.TryParse(Next(), CultureInfo.InvariantCulture, out var t) && t > 0 ? TimeSpan.FromSeconds(t) : throw new ArgumentException("--time must be a positive number of seconds.") }; break;
                case "--threads": o = o with { Threads = int.TryParse(Next(), CultureInfo.InvariantCulture, out var th) && th > 0 ? th : throw new ArgumentException("--threads must be a positive integer.") }; break;
                case "--saturday": o = o with { Saturday = true }; break;
                case "--saturday-codes": o = o with { SaturdayCodes = Next().Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries) }; break;
                case "--prove": o = o with { Prove = true }; break;
                case "--prove-time": o = o with { ProveTime = double.TryParse(Next(), CultureInfo.InvariantCulture, out var pt) && pt > 0 ? TimeSpan.FromSeconds(pt) : throw new ArgumentException("--prove-time must be a positive number of seconds.") }; break;
                case "--institution": o = o with { Institution = Next() }; break;
                case "--verify": o = o with { Verify = true }; break;
                case "-q" or "--quiet": o = o with { Quiet = true }; break;
                case "--lang": o = o with { Lang = Next() }; break;
                case "--show":
                    o = o with { Show = [.. Next().ToLowerInvariant().Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries).Select(ParseShow)] };
                    break;
                case "--limit": o = o with { Limit = int.TryParse(Next(), CultureInfo.InvariantCulture, out var l) && l >= 0 ? l : throw new ArgumentException("--limit must be a non-negative integer.") }; break;
                default: throw new ArgumentException($"Unknown option '{a[i]}'.");
            }
        }
        return o;
    }

    /// <summary>Accepts a plain seed, this tool's token <c>seed/chains/moves</c>, or the original tool's <c>seed/workers/portfolio/sat</c> (only the seed carries over).</summary>
    internal static Options ApplySeed(Options o, string text)
    {
        string[] parts = text.Trim().Split('/', StringSplitOptions.TrimEntries);
        if (!ulong.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out ulong seed))
            throw new ArgumentException("--seed must be a non-negative integer or a reproduction token such as 7/12/30000000.");
        if (parts.Length == 3 && int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out int chains) && chains > 0
            && long.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out long moves) && moves > 0)
            return o with { Seed = seed, Chains = chains, Moves = moves };
        if (parts.Length is 2 or > 4) throw new ArgumentException("--seed must be a non-negative integer or a reproduction token such as 7/12/30000000.");
        return o with { Seed = seed };
    }

    private static string ParseShow(string s) => s is "schedule" or "clashes" ? s : throw new ArgumentException("--show takes schedule and/or clashes.");

    /// <summary>Scripted runs need an existing input; interactive runs ask for it instead of calling this.</summary>
    public void RequireInput()
    {
        if (Input.Length == 0) throw new ArgumentException("Missing --input <enrollment.xlsx>.");
        if (!File.Exists(Input)) throw new ArgumentException($"Input file not found: {Input}");
    }
}
