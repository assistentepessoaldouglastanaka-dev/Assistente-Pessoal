package br.com.assistentepessoal;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Atalhos para as telas de voz do Android, usados pelo Jarvis:
 * - qual mecanismo de voz está ativo (Samsung, Google...);
 * - abrir "Saída de texto em voz" para trocar o mecanismo;
 * - abrir o download de vozes do Google (ou a Play Store, se ele não estiver instalado).
 */
@CapacitorPlugin(name = "Sistema")
public class SistemaPlugin extends Plugin {

    private static final String GOOGLE_TTS = "com.google.android.tts";

    private boolean instalado(String pacote) {
        try {
            getContext().getPackageManager().getPackageInfo(pacote, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    @PluginMethod
    public void mecanismoVoz(PluginCall call) {
        String padrao = Settings.Secure.getString(getContext().getContentResolver(), "tts_default_synth");
        JSObject r = new JSObject();
        r.put("padrao", padrao == null ? "" : padrao);
        r.put("googleInstalado", instalado(GOOGLE_TTS));
        call.resolve(r);
    }

    @PluginMethod
    public void abrirConfigVoz(PluginCall call) {
        try {
            Intent i = new Intent("com.android.settings.TTS_SETTINGS");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            // alguns aparelhos não têm o atalho: abre as configurações gerais
            Intent i = new Intent(Settings.ACTION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        }
    }

    @PluginMethod
    public void baixarVozesGoogle(PluginCall call) {
        JSObject r = new JSObject();
        if (instalado(GOOGLE_TTS)) {
            try {
                Intent i = new Intent(android.speech.tts.TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
                i.setPackage(GOOGLE_TTS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                r.put("abriu", "vozes");
                call.resolve(r);
                return;
            } catch (Exception e) {
                // segue para a Play Store
            }
        }
        Intent loja = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + GOOGLE_TTS));
        loja.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(loja);
        } catch (Exception e) {
            Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + GOOGLE_TTS));
            web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(web);
        }
        r.put("abriu", "loja");
        call.resolve(r);
    }
}
