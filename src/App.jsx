import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [signatureCoords, setSignatureCoords] = useState(null); // { x, y } en escala PDF
  const [clickPos, setClickPos] = useState(null); // { x, y } en píxeles para mostrar indicador visual

  const previewRef = useRef(null);

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('document_tests')
        .select('*')
        .order('id', { ascending: false });
      if (!error) setDocuments(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const generateSHA256 = async (arrayBuffer) => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Capturar clic sobre la vista previa
  const handlePreviewClick = (e) => {
    if (!previewRef.current) return;
    
    const rect = previewRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Dimensiones del contenedor visual
    const containerWidth = rect.width;
    const containerHeight = rect.height;

    // Dimensiones Estándar Carta en Puntos PDF (612 x 792)
    const pdfWidth = 612;
    const pdfHeight = 792;

    // Convertir píxeles de pantalla a coordenadas internas del PDF
    const pdfX = (clickX / containerWidth) * pdfWidth;
    const pdfY = pdfHeight - ((clickY / containerHeight) * pdfHeight);

    setClickPos({ x: clickX, y: clickY });
    setSignatureCoords({ x: pdfX, y: pdfY });
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return alert('Selecciona un archivo PDF.');
    setLoading(true);

    try {
      const cleanName = selectedFile.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const fileName = `${Date.now()}_${cleanName}`;

      const { error: uploadError } = await supabase.storage
        .from('documentos_prueba')
        .upload(fileName, selectedFile);

      if (uploadError) throw new Error(uploadError.message);

      const { data: publicUrlData } = supabase.storage
        .from('documentos_prueba')
        .getPublicUrl(fileName);

      await supabase.from('document_tests').insert({
        title: selectedFile.name,
        file_path: publicUrlData.publicUrl,
        status: 'PENDING'
      });

      alert('¡Archivo subido!');
      setSelectedFile(null);
      e.target.reset();
      fetchDocuments();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignDocument = async (doc) => {
    if (!signatureCoords) {
      alert('Por favor haz clic sobre la vista previa para seleccionar la posición de la firma.');
      return;
    }

    setLoading(true);
    try {
      let ip = '127.0.0.1';
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipRes.json();
        ip = ipData.ip;
      } catch (e) {
        console.warn('IP no disponible');
      }

      const existingPdfBytes = await fetch(doc.file_path).then((res) => res.arrayBuffer());
      const sha256Hash = await generateSHA256(existingPdfBytes);
      const shortHash = sha256Hash.substring(0, 16) + '...';

      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const firstPage = pdfDoc.getPages()[0];
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const stamp = `
      APROBADO - ISO 27001
      Firmante: Supervisor SGSI
      Email: supervisor@empresa.cl
      Fecha: ${new Date().toISOString().split('T')[0]}
      IP: ${ip}
      HASH: ${shortHash}
      `;

      // Estampar exactamente en las coordenadas seleccionadas por el usuario
      firstPage.drawText(stamp.trim(), {
        x: signatureCoords.x,
        y: signatureCoords.y,
        size: 6.5,
        font,
        color: rgb(0, 0.2, 0.6),
        lineHeight: 8,
      });

      const signedPdfBytes = await pdfDoc.save();
      const signedFileName = `SIGNED_${Date.now()}.pdf`;

      await supabase.storage
        .from('documentos_prueba')
        .upload(signedFileName, signedPdfBytes, { contentType: 'application/pdf' });

      const { data: finalUrlData } = supabase.storage
        .from('documentos_prueba')
        .getPublicUrl(signedFileName);

      await supabase
        .from('document_tests')
        .update({ status: 'APPROVED', file_path: finalUrlData.publicUrl })
        .eq('id', doc.id);

      alert('¡Documento firmado en la ubicación seleccionada!');
      setSelectedDoc(null);
      setSignatureCoords(null);
      setClickPos(null);
      fetchDocuments();
    } catch (err) {
      alert('Error en firma: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '30px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Módulo de Firma Digital Interactiva ISO</h2>
      <p style={{ color: '#666' }}>Haz clic sobre la vista previa para seleccionar la posición de la firma.</p>

      <hr style={{ margin: '20px 0' }} />

      <section style={{ background: '#f4f4f4', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
        <h3>1. Subir documento PDF</h3>
        <form onSubmit={handleFileUpload} style={{ display: 'flex', gap: '10px' }}>
          <input type="file" accept=".pdf" onChange={(e) => setSelectedFile(e.target.files[0])} />
          <button type="submit" disabled={loading}>{loading ? 'Subiendo...' : 'Subir Archivo'}</button>
        </form>
      </section>

      <section>
        <h3>2. Seguimiento y Firma</h3>
        <table border="1" cellPadding="8" cellSpacing="0" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#eee' }}>
              <th>ID</th>
              <th>Nombre Archivo</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>#{doc.id}</td>
                <td>{doc.title}</td>
                <td><strong style={{ color: doc.status === 'APPROVED' ? 'green' : 'orange' }}>{doc.status}</strong></td>
                <td>
                  {doc.status === 'PENDING' ? (
                    <button onClick={() => { setSelectedDoc(doc); setClickPos(null); setSignatureCoords(null); }}>
                      Seleccionar Punto & Firmar
                    </button>
                  ) : (
                    <a href={doc.file_path} target="_blank" rel="noreferrer">Ver Firmado</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* MODAL DE SELECCIÓN VISUAL */}
      {selectedDoc && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', width: '550px' }}>
            <h3>Haz clic en la caja donde deseas estampar la firma</h3>
            
            {/* Contenedor Interactivo con Marcador */}
            <div 
              ref={previewRef}
              onClick={handlePreviewClick}
              style={{ position: 'relative', width: '100%', height: '350px', border: '2px dashed #0070f3', cursor: 'crosshair', overflow: 'hidden' }}
            >
              <iframe 
                src={selectedDoc.file_path} 
                width="100%" 
                height="100%" 
                title="PDF Preview" 
                style={{ pointerEvents: 'none' }} // Desactiva la interacción directa con el iframe para capturar el clic
              />

              {/* Indicador rojo visual de la posición seleccionada */}
              {clickPos && (
                <div style={{
                  position: 'absolute',
                  left: `${clickPos.x}px`,
                  top: `${clickPos.y}px`,
                  width: '12px',
                  height: '12px',
                  backgroundColor: 'red',
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 5px rgba(0,0,0,0.5)'
                }} />
              )}
            </div>

            <p style={{ fontSize: '12px', color: signatureCoords ? 'green' : 'red' }}>
              {signatureCoords 
                ? `Punto seleccionado: (X: ${Math.round(signatureCoords.x)}, Y: ${Math.round(signatureCoords.y)})` 
                : 'Haz clic en el área azul del documento para fijar el punto.'}
            </p>

            <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setSelectedDoc(null)}>Cancelar</button>
              <button 
                onClick={() => handleSignDocument(selectedDoc)} 
                disabled={loading || !signatureCoords}
                style={{ background: signatureCoords ? '#16a34a' : '#ccc', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px' }}
              >
                {loading ? 'Procesando...' : 'Estampar Firma Aquí'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}