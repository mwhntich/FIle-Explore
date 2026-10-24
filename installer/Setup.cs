using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class SetupProgram
{
    private const string ProductFolder = "Files Independent";
    private const string Marker = "Files.independent.install";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (args.Length >= 2 && (args[0] == "--install" || args[0] == "--install-silent"))
        {
            try
            {
                Install(args[1], args[0] != "--install-silent", args.Length < 3 || args[2] == "desktop");
                if (args[0] != "--install-silent") MessageBox.Show("Files is installed and ready to use.", "Files", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            catch (Exception ex)
            {
                if (args[0] != "--install-silent") MessageBox.Show(ex.Message, "Files installation failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
        Application.Run(new SetupForm());
        return 0;
    }

    internal static string DefaultPath { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), ProductFolder); } }

    internal static bool NeedsElevation(string folder)
    {
        string programFiles = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles)).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string full = Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
            return full.StartsWith(programFiles, StringComparison.OrdinalIgnoreCase) && !new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    internal static void StartElevated(string folder, bool desktop)
    {
        Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--install \"" + folder + "\" " + (desktop ? "desktop" : "no-desktop"))
        {
            UseShellExecute = true, Verb = "runas"
        });
    }

    internal static void Install(string folder, bool shortcuts, bool desktop)
    {
        string target = Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar);
        if (target.Length < 5 || Path.GetPathRoot(target).TrimEnd(Path.DirectorySeparatorChar).Equals(target, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Choose a dedicated application folder.");
        if (Directory.Exists(target) && Directory.EnumerateFileSystemEntries(target).Any() && !File.Exists(Path.Combine(target, Marker)))
            throw new InvalidOperationException("The selected folder contains other files. Choose an empty folder or an existing Files installation.");

        string temporary = target + ".installing-" + Guid.NewGuid().ToString("N");
        string backup = target + ".previous-" + Guid.NewGuid().ToString("N");
        Directory.CreateDirectory(Path.GetDirectoryName(target));
        Directory.CreateDirectory(temporary);
        bool oldMoved = false;
        try
        {
            using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("FilesPayload"))
            {
                if (payload == null) throw new InvalidOperationException("Installer payload is missing.");
                using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string output = Path.GetFullPath(Path.Combine(temporary, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                        if (!output.StartsWith(temporary + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                            throw new InvalidOperationException("Installer contains an invalid path.");
                        if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(output); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(output));
                        using (Stream input = entry.Open())
                        using (FileStream file = File.Create(output)) input.CopyTo(file);
                    }
                }
            }
            if (!File.Exists(Path.Combine(temporary, "Files.exe"))) throw new InvalidOperationException("Installer payload is incomplete.");
            File.WriteAllText(Path.Combine(temporary, Marker), "Files independent build 1.1.0");
            if (Directory.Exists(target)) { Directory.Move(target, backup); oldMoved = true; }
            Directory.Move(temporary, target);
            if (oldMoved) { try { Directory.Delete(backup, true); } catch { } }
            if (shortcuts)
            {
                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Files (Independent).lnk");
                CreateShortcut(startMenu, Path.Combine(target, "Files.exe"));
                if (desktop)
                {
                    string desktopShortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Files (Independent).lnk");
                    CreateShortcut(desktopShortcut, Path.Combine(target, "Files.exe"));
                }
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FilesIndependent"))
                {
                    key.SetValue("DisplayName", "Files (Independent build)");
                    key.SetValue("DisplayVersion", "1.1.0");
                    key.SetValue("Publisher", "Files Independent");
                    key.SetValue("DisplayIcon", Path.Combine(target, "Files.exe"));
                    key.SetValue("InstallLocation", target);
                    key.SetValue("UninstallString", "\"" + Path.Combine(target, "Uninstall Files.exe") + "\" \"" + target + "\"");
                    key.SetValue("NoModify", 1);
                }
            }
        }
        catch
        {
            if (oldMoved && !Directory.Exists(target) && Directory.Exists(backup)) Directory.Move(backup, target);
            if (Directory.Exists(temporary)) Directory.Delete(temporary, true);
            throw;
        }
    }

    private static void CreateShortcut(string shortcutPath, string executable)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
        Type type = shortcut.GetType();
        type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { executable });
        type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { Path.GetDirectoryName(executable) });
        type.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { executable + ",0" });
        type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
    }
}

internal sealed class SetupForm : Form
{
    private readonly TextBox location;
    private readonly CheckBox desktop;
    private readonly Button install;
    private readonly Label status;

    internal SetupForm()
    {
        Text = "Install Files";
        Width = 540; Height = 300; FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(37, 37, 37); ForeColor = Color.White;
        Font = new Font("Segoe UI", 10);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        PictureBox picture = new PictureBox { Bounds = new Rectangle(22, 24, 56, 56), SizeMode = PictureBoxSizeMode.StretchImage, Image = Icon.ToBitmap() };
        Controls.Add(picture);
        Controls.Add(new Label { Text = "Files", Font = new Font("Segoe UI", 21, FontStyle.Bold), Bounds = new Rectangle(94, 25, 390, 38) });
        Controls.Add(new Label { Text = "Independent Windows file manager", ForeColor = Color.Silver, Bounds = new Rectangle(96, 64, 400, 22) });
        Controls.Add(new Label { Text = "Install location", Bounds = new Rectangle(22, 108, 160, 23) });
        location = new TextBox { Text = SetupProgram.DefaultPath, Bounds = new Rectangle(22, 135, 405, 27) };
        Controls.Add(location);
        Button browse = new Button { Text = "Browse", Bounds = new Rectangle(434, 134, 77, 29) };
        browse.Click += (s, e) => { using (FolderBrowserDialog dialog = new FolderBrowserDialog()) { dialog.SelectedPath = Path.GetDirectoryName(location.Text); if (dialog.ShowDialog() == DialogResult.OK) location.Text = Path.Combine(dialog.SelectedPath, "Files Independent"); } };
        Controls.Add(browse);
        desktop = new CheckBox { Text = "Create desktop shortcut", Checked = true, Bounds = new Rectangle(22, 177, 265, 25) };
        Controls.Add(desktop);
        status = new Label { Text = "", ForeColor = Color.LightGray, Bounds = new Rectangle(22, 220, 360, 24) };
        Controls.Add(status);
        install = new Button { Text = "Install", Bounds = new Rectangle(405, 214, 105, 34), BackColor = Color.FromArgb(43, 143, 186), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
        install.Click += InstallClicked;
        Controls.Add(install);
    }

    private async void InstallClicked(object sender, EventArgs e)
    {
        string target = location.Text.Trim();
        if (target.Length == 0) { MessageBox.Show("Choose an install location."); return; }
        if (SetupProgram.NeedsElevation(target))
        {
            try { SetupProgram.StartElevated(target, desktop.Checked); Close(); }
            catch (Exception ex) { MessageBox.Show(ex.Message, "Elevation required", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            return;
        }
        install.Enabled = false; status.Text = "Installing Files…";
        try
        {
            await Task.Run(() => SetupProgram.Install(target, true, desktop.Checked));
            status.Text = "Installation complete.";
            MessageBox.Show("Files is installed and ready to use.", "Files", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Close();
        }
        catch (Exception ex) { status.Text = "Installation failed."; MessageBox.Show(ex.Message, "Files installation failed", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        finally { install.Enabled = true; }
    }
}
