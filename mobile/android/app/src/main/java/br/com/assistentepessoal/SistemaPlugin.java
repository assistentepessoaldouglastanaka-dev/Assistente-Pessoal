package br.com.assistentepessoal;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.AlarmClock;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

/**
 * Atalhos para as telas de voz do Android, usados pelo Jarvis:
 * - qual mecanismo de voz está ativo (Samsung, Google...);
 * - abrir "Saída de texto em voz" para trocar o mecanismo;
 * - abrir o download de vozes do Google (ou a Play Store, se ele não estiver instalado).
 * E a ponte com o app Relógio (Samsung ou outro): ler o próximo alarme, criar alarmes nele e abrir a lista.
 * O Android não deixa outros apps lerem a lista completa de alarmes do Relógio, só o próximo.
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
    public void proximoAlarme(PluginCall call) {
        AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        AlarmManager.AlarmClockInfo info = am == null ? null : am.getNextAlarmClock();
        JSObject r = new JSObject();
        if (info != null) {
            r.put("quando", info.getTriggerTime());
            String pacote = info.getShowIntent() == null ? "" : info.getShowIntent().getCreatorPackage();
            r.put("pacote", pacote == null ? "" : pacote);
        }
        call.resolve(r);
    }

    @PluginMethod
    public void criarAlarmeRelogio(PluginCall call) {
        Integer hora = call.getInt("hora"), minuto = call.getInt("minuto");
        if (hora == null || minuto == null) { call.reject("hora e minuto obrigatórios"); return; }
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
        i.putExtra(AlarmClock.EXTRA_HOUR, hora);
        i.putExtra(AlarmClock.EXTRA_MINUTES, minuto);
        String rotulo = call.getString("rotulo");
        if (rotulo != null && !rotulo.isEmpty()) i.putExtra(AlarmClock.EXTRA_MESSAGE, rotulo);
        JSArray dias = call.getArray("dias");
        if (dias != null && dias.length() > 0) {
            // o app usa 0 = domingo; o Android usa Calendar.SUNDAY = 1
            ArrayList<Integer> d = new ArrayList<>();
            for (int k = 0; k < dias.length(); k++) d.add(dias.optInt(k) + 1);
            i.putExtra(AlarmClock.EXTRA_DAYS, d);
        }
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Nenhum app de relógio aceitou o alarme");
        }
    }

    @PluginMethod
    public void abrirAlarmesRelogio(PluginCall call) {
        try {
            Intent i = new Intent(AlarmClock.ACTION_SHOW_ALARMS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Relógio não encontrado");
        }
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
