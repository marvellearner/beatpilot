using System;
using System.Globalization;
using System.Runtime.InteropServices;

namespace LaptopVolumeControl {
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out uint pnChannelCount);
        int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
        int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
        int GetMasterVolumeLevel(out float pfLevelDB);
        int GetMasterVolumeLevelScalar(out float pfLevel);
        int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
        int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
        int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
        int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
        int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
        int VolumeStepUp(ref Guid pguidEventContext);
        int VolumeStepDown(ref Guid pguidEventContext);
        int QueryHardwareSupport(out uint pdwHardwareSupportMask);
        int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
    }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    class Program {
        static IAudioEndpointVolume GetMasterAudio() {
            var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
            IMMDevice dev = null;
            // 0 = eRender, 1 = eMultimedia
            int hr = enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
            if (hr != 0 || dev == null) return null;
            var iid = typeof(IAudioEndpointVolume).GUID;
            IAudioEndpointVolume epv = null;
            hr = dev.Activate(ref iid, 23, 0, out epv);
            if (hr != 0 || epv == null) return null;
            return epv;
        }

        static void PrintJson(float volume, bool muted) {
            string volStr = volume.ToString("F3", CultureInfo.InvariantCulture);
            string muteStr = muted ? "true" : "false";
            Console.WriteLine(string.Format("{{\"volume\":{0},\"muted\":{1}}}", volStr, muteStr));
        }

        static int Main(string[] args) {
            try {
                var audio = GetMasterAudio();
                if (audio == null) {
                    Console.WriteLine("{\"error\":\"No audio endpoint available\"}");
                    return 1;
                }

                string action = args.Length > 0 ? args[0].ToLowerInvariant() : "get";
                Guid ctx = Guid.Empty;

                if (action == "set" && args.Length > 1) {
                    float targetVol;
                    if (float.TryParse(args[1], NumberStyles.Float, CultureInfo.InvariantCulture, out targetVol)) {
                        if (targetVol < 0.0f) targetVol = 0.0f;
                        if (targetVol > 1.0f) targetVol = 1.0f;
                        audio.SetMasterVolumeLevelScalar(targetVol, ref ctx);
                        if (targetVol > 0.01f) {
                            // Unmute automatically if user increases volume
                            bool isMuted;
                            audio.GetMute(out isMuted);
                            if (isMuted) audio.SetMute(false, ref ctx);
                        }
                    }
                } else if (action == "mute") {
                    bool shouldMute = true;
                    if (args.Length > 1) {
                        bool.TryParse(args[1], out shouldMute);
                    }
                    audio.SetMute(shouldMute, ref ctx);
                } else if (action == "toggle") {
                    bool curMute;
                    audio.GetMute(out curMute);
                    audio.SetMute(!curMute, ref ctx);
                }

                float finalVol;
                bool finalMute;
                audio.GetMasterVolumeLevelScalar(out finalVol);
                audio.GetMute(out finalMute);

                PrintJson(finalVol, finalMute);
                return 0;
            } catch (Exception ex) {
                Console.WriteLine(string.Format("{{\"error\":\"{0}\"}}", ex.Message.Replace("\"", "'")));
                return 1;
            }
        }
    }
}
