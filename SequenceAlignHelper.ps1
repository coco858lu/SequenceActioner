param(
    [string]$Reference = "",

    [Parameter(Mandatory = $true)]
    [string]$TargetList,

    [string]$OutputPath = "",
    [switch]$BoundsOnly,
    [string]$FrameCounts = "",
    [string]$ProgressPath = ""
)

$ErrorActionPreference = "Stop"
try {
    [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = "BelowNormal"
}
catch { } # Do not fail analysis if process priority cannot be changed.

$source = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Numerics;
using System.Runtime.InteropServices;
using System.IO;
using System.Text.RegularExpressions;

public sealed class AlignmentResult
{
    public double Dx;
    public double Dy;
    public double Confidence;
    public double PeakZ;
}

public static class SpriteFirstFrameAligner
{
    private const int MaxAnalysisDimension = 1024;

    public static void ReportProgress(string path, int completed, int total)
    {
        if (String.IsNullOrEmpty(path)) return;
        try { File.WriteAllText(path, completed + "|" + total); }
        catch (IOException) { } // UI can briefly hold the file while reading.
    }

    public static Rectangle SequenceBounds(string firstPath, int count, string progressPath, int completedBase, int total)
    {
        count = Math.Max(1, count);
        string directory = Path.GetDirectoryName(firstPath);
        Match name = Regex.Match(Path.GetFileName(firstPath), @"^(.*?)(\d+)(\.[^.]+)$");
        if (count > 1 && !name.Success)
            throw new InvalidOperationException("Cannot determine sequence filenames.");
        long first = name.Success ? Int64.Parse(name.Groups[2].Value) : 0;
        Rectangle union = Rectangle.Empty;
        for (int frame = 0; frame < count; frame++)
        {
            ReportProgress(progressPath, completedBase + frame, total);
            string path = frame == 0 ? firstPath : Path.Combine(directory,
                name.Groups[1].Value + (first + frame).ToString("D" + name.Groups[2].Value.Length) + name.Groups[3].Value);
            using (Bitmap original = new Bitmap(path))
            using (Bitmap bitmap = Resize(original, 1.0))
            {
                Rectangle bounds;
                try { bounds = FindAlphaBounds(bitmap); }
                catch (InvalidOperationException) { continue; }
                union = union.IsEmpty ? bounds : Rectangle.Union(union, bounds);
            }
        }
        ReportProgress(progressPath, completedBase + count, total);
        return union;
    }

    public static AlignmentResult Match(string referencePath, string targetPath)
    {
        using (Bitmap referenceOriginal = new Bitmap(referencePath))
        using (Bitmap targetOriginal = new Bitmap(targetPath))
        using (Bitmap referenceFull = Resize(referenceOriginal, 1.0))
        using (Bitmap targetFull = Resize(targetOriginal, 1.0))
        {
            Rectangle referenceBounds = FindAlphaBounds(referenceFull);
            Rectangle targetBounds = FindAlphaBounds(targetFull);
            using (Bitmap referenceCrop = referenceFull.Clone(referenceBounds, PixelFormat.Format32bppArgb))
            using (Bitmap targetCrop = targetFull.Clone(targetBounds, PixelFormat.Format32bppArgb))
            {
            int maxDimension = Math.Max(
                Math.Max(referenceCrop.Width, referenceCrop.Height),
                Math.Max(targetCrop.Width, targetCrop.Height));
            double scale = maxDimension > MaxAnalysisDimension
                ? (double)MaxAnalysisDimension / maxDimension
                : 1.0;

            using (Bitmap reference = Resize(referenceCrop, scale))
            using (Bitmap target = Resize(targetCrop, scale))
            {
                // Linear-correlation padding prevents large offsets from wrapping
                // around to the opposite side of the FFT's periodic canvas.
                int width = NextPowerOfTwo(reference.Width + target.Width - 1);
                int height = NextPowerOfTwo(reference.Height + target.Height - 1);

                Complex[] refSignal = BuildSignal(reference, width, height);
                Complex[] targetSignal = BuildSignal(target, width, height);

                Transform2D(refSignal, width, height, false);
                Transform2D(targetSignal, width, height, false);

                Complex[] correlation = new Complex[refSignal.Length];
                for (int i = 0; i < correlation.Length; i++)
                {
                    Complex cross = Complex.Conjugate(targetSignal[i]) * refSignal[i];
                    double magnitude = cross.Magnitude;
                    correlation[i] = magnitude > 1e-12 ? cross / magnitude : Complex.Zero;
                }

                Transform2D(correlation, width, height, true);

                int peakX = 0;
                int peakY = 0;
                double peak = Double.NegativeInfinity;
                double sum = 0.0;
                double sumSquares = 0.0;
                for (int y = 0; y < height; y++)
                {
                    int row = y * width;
                    for (int x = 0; x < width; x++)
                    {
                        double value = correlation[row + x].Real;
                        sum += value;
                        sumSquares += value * value;
                        if (value > peak)
                        {
                            peak = value;
                            peakX = x;
                            peakY = y;
                        }
                    }
                }

                double count = correlation.Length;
                double mean = sum / count;
                double variance = Math.Max(0.0, sumSquares / count - mean * mean);
                double std = Math.Sqrt(variance);
                double peakZ = std > 1e-12 ? (peak - mean) / std : 0.0;

                double shiftX = peakX > width / 2 ? peakX - width : peakX;
                double shiftY = peakY > height / 2 ? peakY - height : peakY;

                // The phase peak maps target coordinates into reference coordinates.
                double confidence = Math.Max(0.0, Math.Min(1.0, (peakZ - 6.0) / 34.0));
                return new AlignmentResult {
                    // Restore crop origins in the original source-pixel coordinates.
                    Dx = shiftX / scale + referenceBounds.X - targetBounds.X,
                    Dy = shiftY / scale + referenceBounds.Y - targetBounds.Y,
                    Confidence = confidence,
                    PeakZ = peakZ
                };
            }
            }
        }
    }

    private static Rectangle FindAlphaBounds(Bitmap bitmap)
    {
        double[] alpha = ReadAlpha(bitmap);
        int minX = bitmap.Width;
        int minY = bitmap.Height;
        int maxX = -1;
        int maxY = -1;
        for (int y = 0; y < bitmap.Height; y++)
        {
            int row = y * bitmap.Width;
            for (int x = 0; x < bitmap.Width; x++)
            {
                if (alpha[row + x] <= 0.0) continue;
                minX = Math.Min(minX, x);
                minY = Math.Min(minY, y);
                maxX = Math.Max(maxX, x);
                maxY = Math.Max(maxY, y);
            }
        }
        if (maxX < 0) throw new InvalidOperationException("First frame is fully transparent; alignment is undefined.");
        return new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
    }

    private static Bitmap Resize(Bitmap source, double scale)
    {
        if (scale >= 0.999999)
        {
            Bitmap copy = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);
            using (Graphics graphics = Graphics.FromImage(copy))
            {
                graphics.CompositingMode = CompositingMode.SourceCopy;
                graphics.DrawImageUnscaled(source, 0, 0);
            }
            return copy;
        }

        int width = Math.Max(1, (int)Math.Round(source.Width * scale));
        int height = Math.Max(1, (int)Math.Round(source.Height * scale));
        Bitmap resized = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(resized))
        {
            graphics.CompositingMode = CompositingMode.SourceCopy;
            graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            graphics.DrawImage(source, new Rectangle(0, 0, width, height));
        }
        return resized;
    }

    private static Complex[] BuildSignal(Bitmap bitmap, int paddedWidth, int paddedHeight)
    {
        double[] alpha = ReadAlpha(bitmap);
        Complex[] signal = new Complex[paddedWidth * paddedHeight];

        // Alpha carries the silhouette; a small gradient term strengthens shared outlines.
        for (int y = 0; y < bitmap.Height; y++)
        {
            int srcRow = y * bitmap.Width;
            int dstRow = y * paddedWidth;
            for (int x = 0; x < bitmap.Width; x++)
            {
                double center = alpha[srcRow + x];
                double left = x > 0 ? alpha[srcRow + x - 1] : 0.0;
                double up = y > 0 ? alpha[srcRow - bitmap.Width + x] : 0.0;
                double edge = Math.Abs(center - left) + Math.Abs(center - up);
                signal[dstRow + x] = new Complex(center + edge * 0.65, 0.0);
            }
        }
        return signal;
    }

    private static double[] ReadAlpha(Bitmap bitmap)
    {
        Rectangle rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        BitmapData data = bitmap.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            int stride = Math.Abs(data.Stride);
            byte[] bytes = new byte[stride * bitmap.Height];
            Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
            double[] alpha = new double[bitmap.Width * bitmap.Height];
            for (int y = 0; y < bitmap.Height; y++)
            {
                int sourceY = data.Stride >= 0 ? y : bitmap.Height - 1 - y;
                int row = sourceY * stride;
                int targetRow = y * bitmap.Width;
                for (int x = 0; x < bitmap.Width; x++)
                {
                    alpha[targetRow + x] = bytes[row + x * 4 + 3] / 255.0;
                }
            }
            return alpha;
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }

    private static int NextPowerOfTwo(int value)
    {
        int result = 1;
        while (result < value) result <<= 1;
        return result;
    }

    private static void Transform2D(Complex[] values, int width, int height, bool inverse)
    {
        Complex[] buffer = new Complex[Math.Max(width, height)];

        for (int y = 0; y < height; y++)
        {
            int row = y * width;
            Array.Copy(values, row, buffer, 0, width);
            Transform1D(buffer, width, inverse);
            Array.Copy(buffer, 0, values, row, width);
        }

        for (int x = 0; x < width; x++)
        {
            for (int y = 0; y < height; y++) buffer[y] = values[y * width + x];
            Transform1D(buffer, height, inverse);
            for (int y = 0; y < height; y++) values[y * width + x] = buffer[y];
        }
    }

    private static void Transform1D(Complex[] values, int length, bool inverse)
    {
        int j = 0;
        for (int i = 1; i < length; i++)
        {
            int bit = length >> 1;
            while ((j & bit) != 0)
            {
                j ^= bit;
                bit >>= 1;
            }
            j ^= bit;
            if (i < j)
            {
                Complex temp = values[i];
                values[i] = values[j];
                values[j] = temp;
            }
        }

        for (int block = 2; block <= length; block <<= 1)
        {
            double angle = (inverse ? 2.0 : -2.0) * Math.PI / block;
            Complex step = new Complex(Math.Cos(angle), Math.Sin(angle));
            int half = block >> 1;
            for (int start = 0; start < length; start += block)
            {
                Complex factor = Complex.One;
                for (int k = 0; k < half; k++)
                {
                    Complex even = values[start + k];
                    Complex odd = values[start + k + half] * factor;
                    values[start + k] = even + odd;
                    values[start + k + half] = even - odd;
                    factor *= step;
                }
            }
        }

        if (inverse)
        {
            for (int i = 0; i < length; i++) values[i] /= length;
        }
    }
}
'@

$resultLines = New-Object 'System.Collections.Generic.List[string]'
try {
    Add-Type -TypeDefinition $source -ReferencedAssemblies @(
        "System.Drawing",
        "System.Numerics"
    )
}
catch {
    $resultLines.Add("ERROR|-1|" + $_.Exception.Message.Replace("`r", " ").Replace("`n", " "))
    if ($OutputPath) {
        [System.IO.File]::WriteAllLines($OutputPath, $resultLines.ToArray(), [System.Text.Encoding]::UTF8)
    }
    else { $resultLines | ForEach-Object { [Console]::WriteLine($_) } }
    exit 1
}

$Targets = $TargetList.Split([char]'|')
$counts = $FrameCounts.Split([char]',')
$boundsCache = @{}
$completedFrames = 0
$totalFrames = 0
if ($BoundsOnly) {
    foreach ($value in $counts) { $totalFrames += if ($value) { [Math]::Max(1, [int]$value) } else { 1 } }
}
else { $totalFrames = $Targets.Count }
[SpriteFirstFrameAligner]::ReportProgress($ProgressPath, 0, $totalFrames)

for ($index = 0; $index -lt $Targets.Count; $index++) {
    try {
        if ($BoundsOnly) {
            $count = if ($index -lt $counts.Count -and $counts[$index]) { [int]$counts[$index] } else { 1 }
            $key = $Targets[$index] + "|" + $count
            if (-not $boundsCache.ContainsKey($key)) {
                $boundsCache[$key] = [SpriteFirstFrameAligner]::SequenceBounds($Targets[$index], $count, $ProgressPath, $completedFrames, $totalFrames)
            }
            $bounds = $boundsCache[$key]
            $resultLines.Add("BOUNDS|" + $index + "|" + $bounds.X + "|" + $bounds.Y + "|" + $bounds.Width + "|" + $bounds.Height)
            $completedFrames += $count
            [SpriteFirstFrameAligner]::ReportProgress($ProgressPath, $completedFrames, $totalFrames)
            continue
        }
        $result = [SpriteFirstFrameAligner]::Match($Reference, $Targets[$index])
        $resultLines.Add([string]::Format(
            [System.Globalization.CultureInfo]::InvariantCulture,
            "ALIGN|{0}|{1:R}|{2:R}|{3:R}|{4:R}",
            @($index, $result.Dx, $result.Dy, $result.Confidence, $result.PeakZ)
        ))
    }
    catch {
        $message = $_.Exception.Message.Replace("`r", " ").Replace("`n", " ").Replace("|", "/")
        $resultLines.Add("ERROR|" + $index + "|" + $message)
        if ($BoundsOnly) { $completedFrames += [Math]::Max(1, $count) }
    }
    [SpriteFirstFrameAligner]::ReportProgress($ProgressPath, $(if ($BoundsOnly) { $completedFrames } else { $index + 1 }), $totalFrames)
}

if ($OutputPath) {
    [System.IO.File]::WriteAllLines($OutputPath, $resultLines.ToArray(), [System.Text.Encoding]::UTF8)
}
else {
    $resultLines | ForEach-Object { [Console]::WriteLine($_) }
}
