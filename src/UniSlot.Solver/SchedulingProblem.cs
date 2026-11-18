using System.Runtime.CompilerServices;

[assembly: InternalsVisibleTo("UniSlot.Tests")]

namespace UniSlot.Solver;

/// <summary>
/// Immutable, integer-indexed course→weekday colouring problem. Everything the search needs is flattened into
/// compressed-sparse-row arrays so the hot loops never touch strings, dictionaries or allocations.
/// </summary>
/// <remarks>
/// Only students with two or more distinct courses are stored: a single-course student can never clash.
/// Clash edges are unique unordered course pairs weighted by the number of shared students.
/// </remarks>
public sealed class SchedulingProblem
{
    private readonly string[] _codes;
    private readonly int[] _sectionCounts;
    private readonly int[] _allowedDays;
    private readonly int[] _fixedDays;
    private readonly int[] _edgeA;
    private readonly int[] _edgeB;
    private readonly int[] _edgeWeight;
    private readonly int[] _studentOffsets;
    private readonly int[] _studentCourses;
    private readonly int[] _groupOffsets;
    private readonly int[] _groupCourses;

    // Derived CSR views used by the engines.
    internal readonly int[] AdjStart;
    internal readonly int[] AdjNeighbor;
    internal readonly int[] AdjWeight;
    internal readonly int[] CourseStudentStart;
    internal readonly int[] CourseStudentList;
    internal readonly int[] CourseGroupStart;
    internal readonly int[] CourseGroupList;
    internal readonly int[] Movable;

    public SchedulingProblem(
        IReadOnlyList<string> courseCodes,
        int[] sectionCounts,
        int[] allowedDayCounts,
        int[] fixedDays,
        int weekdayCount,
        int preferredParallel,
        int[] edgeA,
        int[] edgeB,
        int[] edgeWeights,
        int[] studentOffsets,
        int[] studentCourses,
        int[] groupOffsets,
        int[] groupCourses,
        int totalStudents)
    {
        ArgumentNullException.ThrowIfNull(courseCodes);
        int n = courseCodes.Count;
        if (n == 0) throw new ArgumentException("A problem needs at least one course.", nameof(courseCodes));
        if (weekdayCount is < 2 or > 7) throw new ArgumentOutOfRangeException(nameof(weekdayCount));
        RequireLength(sectionCounts, n, nameof(sectionCounts));
        RequireLength(allowedDayCounts, n, nameof(allowedDayCounts));
        RequireLength(fixedDays, n, nameof(fixedDays));
        if (edgeA.Length != edgeB.Length || edgeA.Length != edgeWeights.Length)
            throw new ArgumentException("Edge arrays must have equal length.");

        _codes = [.. courseCodes];
        _sectionCounts = (int[])sectionCounts.Clone();
        _allowedDays = (int[])allowedDayCounts.Clone();
        _fixedDays = (int[])fixedDays.Clone();
        WeekdayCount = weekdayCount;
        PreferredParallel = preferredParallel;
        TotalStudents = totalStudents;

        for (int c = 0; c < n; c++)
        {
            if (_sectionCounts[c] < 1) throw new ArgumentException($"Course {_codes[c]} needs at least one section.");
            if (_allowedDays[c] < 1 || _allowedDays[c] > weekdayCount)
                throw new ArgumentException($"Course {_codes[c]} has an invalid allowed-day count {_allowedDays[c]}.");
            if (_fixedDays[c] >= _allowedDays[c])
                throw new ArgumentException($"Course {_codes[c]} is pinned outside its allowed days.");
            TotalSections += _sectionCounts[c];
        }

        _edgeA = (int[])edgeA.Clone();
        _edgeB = (int[])edgeB.Clone();
        _edgeWeight = (int[])edgeWeights.Clone();
        for (int e = 0; e < _edgeA.Length; e++)
        {
            if ((uint)_edgeA[e] >= (uint)n || (uint)_edgeB[e] >= (uint)n || _edgeA[e] == _edgeB[e])
                throw new ArgumentException($"Edge {e} references invalid courses.");
            if (_edgeWeight[e] <= 0) throw new ArgumentException($"Edge {e} must have a positive weight.");
            TotalEdgeWeight += _edgeWeight[e];
        }

        _studentOffsets = (int[])studentOffsets.Clone();
        _studentCourses = (int[])studentCourses.Clone();
        ValidateCsr(_studentOffsets, _studentCourses, n, "students");
        _groupOffsets = (int[])groupOffsets.Clone();
        _groupCourses = (int[])groupCourses.Clone();
        ValidateCsr(_groupOffsets, _groupCourses, n, "faculty groups");

        // adjacency
        var degree = new int[n + 1];
        for (int e = 0; e < _edgeA.Length; e++) { degree[_edgeA[e]]++; degree[_edgeB[e]]++; }
        AdjStart = PrefixSum(degree, n);
        AdjNeighbor = new int[AdjStart[n]];
        AdjWeight = new int[AdjStart[n]];
        var fill = (int[])AdjStart.Clone();
        for (int e = 0; e < _edgeA.Length; e++)
        {
            int a = _edgeA[e], b = _edgeB[e], w = _edgeWeight[e];
            AdjNeighbor[fill[a]] = b; AdjWeight[fill[a]++] = w;
            AdjNeighbor[fill[b]] = a; AdjWeight[fill[b]++] = w;
        }

        // course → students (student index space is 0..StudentCount-1)
        var cs = new int[n + 1];
        foreach (int c in _studentCourses) cs[c]++;
        CourseStudentStart = PrefixSum(cs, n);
        CourseStudentList = new int[CourseStudentStart[n]];
        var sf = (int[])CourseStudentStart.Clone();
        for (int s = 0; s < StudentCount; s++)
            for (int i = _studentOffsets[s]; i < _studentOffsets[s + 1]; i++)
                CourseStudentList[sf[_studentCourses[i]]++] = s;

        // course → faculty groups
        var cg = new int[n + 1];
        foreach (int c in _groupCourses) cg[c]++;
        CourseGroupStart = PrefixSum(cg, n);
        CourseGroupList = new int[CourseGroupStart[n]];
        var gf = (int[])CourseGroupStart.Clone();
        for (int g = 0; g < GroupCount; g++)
            for (int i = _groupOffsets[g]; i < _groupOffsets[g + 1]; i++)
                CourseGroupList[gf[_groupCourses[i]]++] = g;

        var movable = new List<int>(n);
        for (int c = 0; c < n; c++)
            if (_fixedDays[c] < 0 && _allowedDays[c] > 1) movable.Add(c);
        Movable = [.. movable];
    }

    public int CourseCount => _codes.Length;
    /// <summary>Students with two or more distinct courses (the only ones that can clash).</summary>
    public int StudentCount => _studentOffsets.Length - 1;
    /// <summary>All students in the workbook, including single-course ones (reporting only).</summary>
    public int TotalStudents { get; }
    public int GroupCount => _groupOffsets.Length - 1;
    public int WeekdayCount { get; }
    public int PreferredParallel { get; }
    public int TotalSections { get; }
    public long TotalEdgeWeight { get; }
    public int EdgeCount => _edgeA.Length;

    public string CourseCode(int course) => _codes[course];
    public int SectionCount(int course) => _sectionCounts[course];
    public int AllowedDays(int course) => _allowedDays[course];
    public int FixedDay(int course) => _fixedDays[course];
    /// <summary>True when the course may use Saturday (the sixth weekday).</summary>
    public bool IsSaturdayEligible(int course) => WeekdayCount == 6 && _allowedDays[course] == 6;

    public ReadOnlySpan<int> EdgeA => _edgeA;
    public ReadOnlySpan<int> EdgeB => _edgeB;
    public ReadOnlySpan<int> EdgeWeights => _edgeWeight;
    public ReadOnlySpan<int> StudentCourses(int student) =>
        _studentCourses.AsSpan(_studentOffsets[student], _studentOffsets[student + 1] - _studentOffsets[student]);
    public ReadOnlySpan<int> GroupCourses(int group) =>
        _groupCourses.AsSpan(_groupOffsets[group], _groupOffsets[group + 1] - _groupOffsets[group]);

    private static void RequireLength(int[] array, int expected, string name)
    {
        if (array.Length != expected) throw new ArgumentException($"{name} must have {expected} entries.", name);
    }

    private static void ValidateCsr(int[] offsets, int[] items, int courseCount, string what)
    {
        if (offsets.Length == 0 || offsets[0] != 0 || offsets[^1] != items.Length)
            throw new ArgumentException($"Malformed offsets for {what}.");
        for (int i = 1; i < offsets.Length; i++)
            if (offsets[i] < offsets[i - 1]) throw new ArgumentException($"Offsets for {what} must not decrease.");
        foreach (int c in items)
            if ((uint)c >= (uint)courseCount) throw new ArgumentException($"{what} reference an unknown course.");
    }

    private static int[] PrefixSum(int[] counts, int n)
    {
        var start = new int[n + 1];
        int running = 0;
        for (int i = 0; i < n; i++) { start[i] = running; running += counts[i]; }
        start[n] = running;
        return start;
    }
}
