using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class UninstallProgram
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length < 1) return 1;
        string target = Path.GetFullPath(args[args.Length - 1]).TrimEnd(Path.DirectorySeparatorChar);
        string marker = Path.Combine(target, "Files.independent.install");
        if (!File.Exists(marker) || !File.Exists(Path.Combine(target, "Files.exe")) || !File.ReadAllText(marker).StartsWith("Files independent build")) return 1;
        if (args[0] != "--remove")
        {
            if (MessageBox.Show("Remove Files from this computer?", "Uninstall Files", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 0;
            string helper = Path.Combine(Path.GetTempPath(), "Files-Uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
            File.Copy(Application.ExecutablePath, helper);
            bool isAdmin;
            using (WindowsIdentity identity = WindowsIdentity.GetCurrent()) isAdmin = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
            bool needsAdmin = target.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), StringComparison.OrdinalIgnoreCase) && !isAdmin;
            Process.Start(new ProcessStartInfo(helper, "--remove \"" + target + "\"") { UseShellExecute = true, Verb = needsAdmin ? "runas" : "open", WindowStyle = ProcessWindowStyle.Hidden });
            return 0;
        }
        try
        {
            Thread.Sleep(1200);
            string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Files (Independent).lnk");
            string desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Files (Independent).lnk");
            DeleteShortcutIfOwned(startMenu, target);
            DeleteShortcutIfOwned(desktop, target);
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FilesIndependent"))
                if (key != null && String.Equals(key.GetValue("InstallLocation") as string, target, StringComparison.OrdinalIgnoreCase))
                    Registry.CurrentUser.DeleteSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FilesIndependent", false);
            Directory.Delete(target, true);
            MessageBox.Show("Files was removed.", "Uninstall Files", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Could not uninstall Files", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static void DeleteShortcutIfOwned(string shortcutPath, string target)
    {
        if (!File.Exists(shortcutPath)) return;
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
        string destination = shortcut.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null) as string;
        if (String.Equals(destination, Path.Combine(target, "Files.exe"), StringComparison.OrdinalIgnoreCase)) File.Delete(shortcutPath);
    }
}
