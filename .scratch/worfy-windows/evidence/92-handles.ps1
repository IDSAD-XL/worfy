# Probe of worfy-windows 92 (not product code): lists the handles of one process by object type,
# with the target of each Process handle (image, pid, alive or exited) and the file type of each
# File handle (disk, char, pipe). Read-only: duplicates handles into this process only to query
# them. 92-probe.ts calls it at every step as handles.ps1 next to its bundle.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File handles.ps1 -TargetPid <pid>   -> one JSON line
param([Parameter(Mandatory = $true)][int]$TargetPid)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class HandleProbe {
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int cls, IntPtr buf, int len, out int ret);
  [DllImport("ntdll.dll")] static extern int NtQueryObject(IntPtr h, int cls, IntPtr buf, int len, out int ret);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DuplicateHandle(IntPtr srcProc, IntPtr src, IntPtr dstProc, out IntPtr dst, int access, bool inherit, int options);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern int GetProcessId(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out int code);
  [DllImport("kernel32.dll")] static extern int GetFileType(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr h, int flags, StringBuilder sb, ref int size);

  static Dictionary<int, string> TypeNames() {
    var names = new Dictionary<int, string>();
    int len = 1 << 16; IntPtr buf = IntPtr.Zero; int ret;
    while (true) {
      buf = Marshal.AllocHGlobal(len);
      int st = NtQueryObject(IntPtr.Zero, 3, buf, len, out ret);
      if (st == 0) break;
      Marshal.FreeHGlobal(buf);
      if (st != unchecked((int)0xC0000004)) throw new Exception("NtQueryObject types: " + st.ToString("X"));
      len *= 2;
    }
    int count = Marshal.ReadInt32(buf);
    long p = buf.ToInt64() + 8;
    for (int i = 0; i < count; i++) {
      ushort nameLen = (ushort)Marshal.ReadInt16(new IntPtr(p));
      ushort nameMax = (ushort)Marshal.ReadInt16(new IntPtr(p + 2));
      IntPtr nameBuf = Marshal.ReadIntPtr(new IntPtr(p + 8));
      string name = Marshal.PtrToStringUni(nameBuf, nameLen / 2);
      int index = Marshal.ReadByte(new IntPtr(p + 0x5A));
      names[index] = name;
      p += 0x68 + ((nameMax + 7) & ~7);
    }
    Marshal.FreeHGlobal(buf);
    return names;
  }

  public static string Run(int pid) {
    var names = TypeNames();
    int len = 1 << 22; IntPtr buf; int ret;
    while (true) {
      buf = Marshal.AllocHGlobal(len);
      int st = NtQuerySystemInformation(64, buf, len, out ret);
      if (st == 0) break;
      Marshal.FreeHGlobal(buf);
      if (st != unchecked((int)0xC0000004)) throw new Exception("NtQuerySystemInformation: " + st.ToString("X"));
      len *= 2;
    }
    long n = Marshal.ReadInt64(buf);
    var counts = new SortedDictionary<string, int>();
    var procs = new List<string>();
    var files = new SortedDictionary<string, int>();
    IntPtr src = OpenProcess(0x0040, false, pid); // PROCESS_DUP_HANDLE
    IntPtr me = GetCurrentProcess();
    int total = 0;
    for (long i = 0; i < n; i++) {
      long e = buf.ToInt64() + 16 + i * 40;
      long owner = Marshal.ReadInt64(new IntPtr(e + 8));
      if (owner != pid) continue;
      total++;
      long value = Marshal.ReadInt64(new IntPtr(e + 16));
      int typeIndex = (ushort)Marshal.ReadInt16(new IntPtr(e + 30));
      string type = names.ContainsKey(typeIndex) ? names[typeIndex] : ("#" + typeIndex);
      counts[type] = counts.ContainsKey(type) ? counts[type] + 1 : 1;
      if (src == IntPtr.Zero) continue;
      if (type == "Process") {
        IntPtr dup;
        if (!DuplicateHandle(src, new IntPtr(value), me, out dup, 0x1000, false, 0)) { procs.Add("0x" + value.ToString("X") + ":?"); continue; }
        int target = GetProcessId(dup);
        int code; GetExitCodeProcess(dup, out code);
        var sb = new StringBuilder(1024); int size = sb.Capacity;
        string image = QueryFullProcessImageNameW(dup, 0, sb, ref size) ? System.IO.Path.GetFileName(sb.ToString()) : "?";
        procs.Add("0x" + value.ToString("X") + ":" + image + ":" + target + ":" + (code == 259 ? "alive" : "exited"));
        CloseHandle(dup);
      } else if (type == "File") {
        IntPtr dup;
        string kind = "?";
        if (DuplicateHandle(src, new IntPtr(value), me, out dup, 0, false, 2)) {
          int ft = GetFileType(dup);
          kind = ft == 1 ? "disk" : ft == 2 ? "char" : ft == 3 ? "pipe" : ("type" + ft);
          CloseHandle(dup);
        }
        files[kind] = files.ContainsKey(kind) ? files[kind] + 1 : 1;
      }
    }
    if (src != IntPtr.Zero) CloseHandle(src);
    Marshal.FreeHGlobal(buf);
    var sbOut = new StringBuilder();
    sbOut.Append("{\"total\":" + total + ",\"types\":{");
    bool first = true;
    foreach (var kv in counts) { if (!first) sbOut.Append(","); first = false; sbOut.Append("\"" + kv.Key + "\":" + kv.Value); }
    sbOut.Append("},\"files\":{");
    first = true;
    foreach (var kv in files) { if (!first) sbOut.Append(","); first = false; sbOut.Append("\"" + kv.Key + "\":" + kv.Value); }
    sbOut.Append("},\"processes\":[");
    first = true;
    foreach (var s in procs) { if (!first) sbOut.Append(","); first = false; sbOut.Append("\"" + s + "\""); }
    sbOut.Append("]}");
    return sbOut.ToString();
  }
}
'@
$json = [HandleProbe]::Run($TargetPid)
$kids = @(Get-CimInstance -Query "SELECT ProcessId, Name FROM Win32_Process WHERE ParentProcessId = $TargetPid" | ForEach-Object { '"' + $_.Name + ':' + $_.ProcessId + '"' }) -join ','
$hc = (Get-Process -Id $TargetPid).HandleCount
$th = (Get-Process -Id $TargetPid).Threads.Count
$json.TrimEnd('}') + ',"handleCount":' + $hc + ',"threads":' + $th + ',"children":[' + $kids + ']}'
