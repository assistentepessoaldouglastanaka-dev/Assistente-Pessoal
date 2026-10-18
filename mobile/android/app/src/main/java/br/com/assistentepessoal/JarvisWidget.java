package br.com.assistentepessoal;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;
import org.json.JSONObject;

/**
 * Widget do Jarvis na tela inicial.
 * - Toque no reator: abre o app com o Jarvis já ouvindo (br.com.assistentepessoal://jarvis).
 * - Toque no resto: abre o Início.
 * O resumo do dia é gravado pelo app (plugin Preferences) na chave "jarvis_widget".
 */
public class JarvisWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, montar(context));
    }

    private static RemoteViews montar(Context context) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_jarvis);
        try {
            SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String bruto = prefs.getString("jarvis_widget", null);
            if (bruto != null) {
                JSONObject d = new JSONObject(bruto);
                v.setTextViewText(R.id.widget_linha1, d.optString("linha1", "Toque no reator para falar"));
                v.setTextViewText(R.id.widget_linha2, d.optString("linha2", ""));
                v.setTextViewText(R.id.widget_linha3, d.optString("linha3", ""));
            }
        } catch (Exception e) {
            // mantém o texto padrão
        }
        v.setOnClickPendingIntent(R.id.widget_reator, link(context, "br.com.assistentepessoal://jarvis", 1));
        v.setOnClickPendingIntent(R.id.widget_corpo, link(context, "br.com.assistentepessoal://inicio", 2));
        return v;
    }

    private static PendingIntent link(Context context, String uri, int codigo) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri), context, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, codigo, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Atualiza todos os widgets com o resumo mais recente (chamado quando o app vai para segundo plano). */
    public static void atualizar(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, JarvisWidget.class));
        if (ids.length == 0) return;
        RemoteViews v = montar(context);
        for (int id : ids) manager.updateAppWidget(id, v);
    }
}
