package br.com.assistentepessoal;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // atalhos para as telas de voz do Android (plugin do próprio app)
        registerPlugin(SistemaPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPause() {
        super.onPause();
        // ao sair do app, o widget mostra o resumo atualizado
        JarvisWidget.atualizar(this);
    }
}
