package com.trainticket.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.trainticket.app.plugin.TicketBridgePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TicketBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
