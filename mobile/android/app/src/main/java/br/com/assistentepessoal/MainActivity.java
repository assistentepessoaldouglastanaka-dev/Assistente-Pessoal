package br.com.assistentepessoal;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onPause() {
        super.onPause();
        // ao sair do app, o widget mostra o resumo atualizado
        JarvisWidget.atualizar(this);
    }
}
