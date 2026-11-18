using System.Numerics;
using System.Runtime.CompilerServices;

namespace UniSlot.Solver;

/// <summary>
/// Arithmetic that is bit-for-bit identical on every platform. Only IEEE-754 basic operations (+ − × ÷, floor, exact
/// scaling) are used, never libm, so a seed reproduces the same schedule on Windows, macOS and Linux, x64 and ARM64.
/// </summary>
public static class DeterministicMath
{
    private const double Ln2 = 0.6931471805599453;

    /// <summary>exp(−x) for x ≥ 0, accurate to ~1e-15 relative error.</summary>
    public static double ExpNeg(double x)
    {
        if (x <= 0) return 1.0;
        if (x > 700) return 0.0;
        double k = Math.Floor(x / Ln2);
        double r = x - k * Ln2; // 0 ≤ r < ln2
        double term = 1.0, sum = 1.0;
        for (int i = 1; i <= 14; i++)
        {
            term *= -r / i;
            sum += term;
        }
        return Math.ScaleB(sum, -(int)k);
    }
}

/// <summary>SplitMix64 — used only to expand a seed into independent per-chain generator states.</summary>
public static class SplitMix64
{
    public static ulong Next(ref ulong state)
    {
        ulong z = state += 0x9E3779B97F4A7C15UL;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        return z ^ (z >> 31);
    }
}

/// <summary>xoshiro256** — small, fast and fully specified, so streams are stable across runtimes.</summary>
public struct Xoshiro256
{
    private ulong _s0, _s1, _s2, _s3;

    public Xoshiro256(ulong seed)
    {
        ulong sm = seed;
        _s0 = SplitMix64.Next(ref sm);
        _s1 = SplitMix64.Next(ref sm);
        _s2 = SplitMix64.Next(ref sm);
        _s3 = SplitMix64.Next(ref sm);
        if ((_s0 | _s1 | _s2 | _s3) == 0) _s0 = 1;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ulong Next64()
    {
        ulong result = BitOperations.RotateLeft(_s1 * 5, 7) * 9;
        ulong t = _s1 << 17;
        _s2 ^= _s0;
        _s3 ^= _s1;
        _s1 ^= _s2;
        _s0 ^= _s3;
        _s2 ^= t;
        _s3 = BitOperations.RotateLeft(_s3, 45);
        return result;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public uint Next32() => (uint)(Next64() >> 32);

    /// <summary>Uniform integer in [0, bound) using a multiply-shift (no modulo bias worth caring about at these sizes).</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int Below(int bound) => (int)(((ulong)Next32() * (ulong)bound) >> 32);
}
