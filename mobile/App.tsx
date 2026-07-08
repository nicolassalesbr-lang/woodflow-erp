import React, { useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  TextInput, 
  ScrollView, 
  Alert 
} from 'react-native';

export default function App() {
  const [operatorId, setOperatorId] = useState('');
  const [scannedCode, setScannedCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [checklist, setChecklist] = useState([
    { id: 1, text: 'Acabamento das bordas verificado', checked: false },
    { id: 2, text: 'Medidas batem com projeto DWG', checked: false },
    { id: 3, text: 'Ausência de riscos no MDF', checked: false },
  ]);

  const handleScan = () => {
    if (!operatorId) {
      Alert.alert('Erro', 'Por favor, insira seu ID de Operador antes de escanear.');
      return;
    }
    setIsScanning(true);
    // Simulate camera QR code capture
    setTimeout(() => {
      setScannedCode('QR-WF-PROJ1-CUT');
      setIsScanning(false);
      Alert.alert('QR Code Lido', 'Código QR-WF-PROJ1-CUT detectado com sucesso!');
    }, 1500);
  };

  const toggleCheck = (id: number) => {
    setChecklist(
      checklist.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    );
  };

  const submitProductionStatus = () => {
    if (!scannedCode || !operatorId) {
      Alert.alert('Erro', 'Leia o QR code e preencha as credenciais.');
      return;
    }
    const allChecked = checklist.every((c) => c.checked);
    if (!allChecked) {
      Alert.alert('Aviso', 'Por favor, conclua todos os itens de qualidade antes de prosseguir.');
      return;
    }

    Alert.alert(
      'Sucesso',
      `Ordem de corte enviada com sucesso!\nOperador: ${operatorId}\nCódigo: ${scannedCode}`
    );
    setScannedCode('');
    setChecklist(checklist.map((c) => ({ ...c, checked: false })));
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View className="header" style={styles.header}>
        <Text style={styles.headerTitle}>WoodFlow Mobile</Text>
        <Text style={styles.headerSubtitle}>Operador PCP & Montagem</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>ID do Operador</Text>
        <TextInput 
          value={operatorId}
          onChangeText={setOperatorId}
          placeholder="Ex: OP-104"
          placeholderTextColor="#6b7280"
          style={styles.input}
        />
      </View>

      <TouchableOpacity onPress={handleScan} style={styles.scanButton}>
        <Text style={styles.btnText}>{isScanning ? 'Lendo câmera...' : 'Escanear QR Code de Produção'}</Text>
      </TouchableOpacity>

      {scannedCode ? (
        <View style={styles.card}>
          <Text style={styles.label}>Item Lido: <Text style={styles.codeText}>{scannedCode}</Text></Text>
          
          <Text style={styles.sectionTitle}>Checklist de Qualidade</Text>
          {checklist.map((item) => (
            <TouchableOpacity 
              key={item.id} 
              onPress={() => toggleCheck(item.id)}
              style={styles.checkRow}
            >
              <View style={[styles.checkbox, item.checked && styles.checkedBox]} />
              <Text style={styles.checkText}>{item.text}</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity onPress={submitProductionStatus} style={styles.submitButton}>
            <Text style={styles.btnText}>Concluir Etapa</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#030712',
    padding: 24,
    paddingTop: 60,
  },
  header: {
    marginBottom: 30,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 4,
  },
  card: {
    backgroundColor: 'rgba(17, 24, 39, 0.7)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(75, 85, 99, 0.15)',
    padding: 20,
    marginBottom: 20,
  },
  label: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#030712',
    color: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(75, 85, 99, 0.3)',
    padding: 12,
    fontSize: 14,
  },
  scanButton: {
    backgroundColor: '#10b981',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  submitButton: {
    backgroundColor: '#06b6d4',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  btnText: {
    color: '#030712',
    fontSize: 14,
    fontWeight: 'bold',
  },
  codeText: {
    color: '#10b981',
    fontWeight: 'bold',
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 15,
    marginBottom: 10,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#10b981',
    marginRight: 12,
  },
  checkedBox: {
    backgroundColor: '#10b981',
  },
  checkText: {
    color: '#d1d5db',
    fontSize: 13,
    flex: 1,
  },
});
