import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const [normalizedCoords, setNormalizedCoords] = useState(null);
  const [clickPos, setClickPos] = useState(null);

  const previewRef = useRef(null);

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('document_tests')
        .select('*')
        .order('id', { ascending: false });
      if (!error) setDocuments(data || []);
    } catch (err) {
      console.error('Error consultando Supabase:', err);
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

  const handlePreviewClick = (e) => {
    if (!previewRef.current) return;
    
    const rect = previewRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const percentX = clickX / rect.width;
    const percentY = clickY / rect.height;

    setClickPos({ x: clickX, y: clickY });
    setNormalizedCoords({ percentX, percentY });
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return alert('Por favor selecciona un archivo PDF.');
    setLoading(true);

    try {
      const cleanName = selectedFile.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const fileName = `${Date.now()}_${cleanName}`;

      const { error: uploadError } = await supabase.storage
        .from('documentos_prueba')
        .upload(fileName, selectedFile);

      if (uploadError) throw new Error('Error en Storage: ' + uploadError.message);

      const { data: publicUrlData } = supabase.storage
        .from('documentos_prueba')
        .getPublicUrl(fileName);

      const { error: dbError } = await supabase
        .from('document_tests')
        .insert({
          title: selectedFile.name,
          file_path: publicUrlData.publicUrl,
          status: 'PENDING'
        });

      if (dbError) throw new Error('Error en BD: ' + dbError.message);

      alert('¡Archivo subido con éxito!');
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
    if (!normalizedCoords) {
      alert('Por favor haz clic sobre la vista previa para seleccionar la posición.');
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
      const shortHash = sha256Hash.substring(0, 12) + '...';

      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const firstPage = pdfDoc.getPages()[0];
      
      const { width: pdfWidth, height: pdfHeight } = firstPage.getSize();

      // Ajustamos targetY para compensar la altura del bloque compacto (3 líneas = ~21pt)
      const targetX = normalizedCoords.percentX * pdfWidth;
      const targetY = pdfHeight - (normalizedCoords.percentY * pdfHeight) + 10;

      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Formato ultracompacto en 3 líneas
      const stamp = `
      [ FIRMA DIGITAL ISO 27001 ]
      Firmante: Supervisor SGSI (supervisor@empresa.cl)
      Fecha: ${new Date().toISOString().split('T')[0]} | IP: ${ip} | HASH: ${shortHash}
      `;

      firstPage.drawText(stamp.trim(), {
        x: targetX,
        y: Math.max(10, targetY),
        size: 5.5,
        font,
        color: rgb(0, 0.2, 0.6),
        lineHeight: 7,
      });

      const signedPdfBytes = await pdfDoc.save();
      const signedFileName = `SIGNED_${Date.now()}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('documentos_prueba')
        .upload(signedFileName, signedPdfBytes, { contentType: 'application/pdf' });

      if (uploadError) throw new Error('Error al guardar firma: ' + uploadError.message);

      const { data: finalUrlData } = supabase.storage
        .from('documentos_prueba')
        .getPublicUrl(signedFileName);

      await supabase
        .from('document_tests')
        .update({ status: 'APPROVED', file_path: finalUrlData.publicUrl })
        .eq('id', doc.id);

      alert('¡Documento firmado en el recuadro exacto!');
      setSelectedDoc(null);
      setNormalizedCoords(null);
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
      <h2>Módulo de Firma Digital Adaptativa ISO</h2>
      <p style={{ color: '#666' }}>Sello compacto ajustado al recuadro con Hash SHA-256.</p>

      <hr style={{ margin: '20px 0' }} />

      <section style={{ background: '#f4f4f4', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
        <h3>1. Subir documento PDF para prueba</h3>
        <form onSubmit={handleFileUpload} style={{ display: 'flex', gap: '10px' }}>
          <input type="file" accept=".pdf" onChange={(e) => setSelectedFile(e.target.files[0])} />
          <button type="submit" disabled={loading} style={{ padding: '8px 16px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            {loading ? 'Subiendo...' : 'Subir Archivo'}
          </button>
        </form>
      </section>

      <section>
        <h3>2. Seguimiento y Firma de Documentos</h3>
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
            {documents.length === 0 ? (
              <tr><td colSpan="4">No hay documentos registrados.</td></tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id}>
                  <td>#{doc.id}</td>
                  <td>{doc.title}</td>
                  <td>
                    <strong style={{ color: doc.status === 'APPROVED' ? 'green' : 'orange' }}>
                      {doc.status}
                    </strong>
                  </td>
                  <td>
                    {doc.status === 'PENDING' ? (
                      <button 
                        onClick={() => { setSelectedDoc(doc); setClickPos(null); setNormalizedCoords(null); }}
                        style={{ padding: '4px 8px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        Ubicar & Firmar
                      </button>
                    ) : (
                      <a href={doc.file_path} target="_blank" rel="noreferrer" style={{ color: '#0070f3' }}>
                        Ver Firmado
                      </a>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {selectedDoc && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', width: '420px' }}>
            <h3>Haz clic dentro del recuadro de firma</h3>
            
            <div 
              ref={previewRef}
              onClick={handlePreviewClick}
              style={{ 
                position: 'relative', 
                width: '100%', 
                aspectRatio: '1 / 1.294', 
                border: '2px dashed #0070f3', 
                cursor: 'crosshair', 
                overflow: 'hidden' 
              }}
            >
              <iframe 
                src={`${selectedDoc.file_path}#toolbar=0&navpanes=0&view=FitH`} 
                width="100%" 
                height="100%" 
                title="PDF Preview" 
                style={{ pointerEvents: 'none', border: 'none' }}
              />

              {clickPos && (
                <div style={{
                  position: 'absolute',
                  left: `${clickPos.x}px`,
                  top: `${clickPos.y}px`,
                  width: '10px',
                  height: '10px',
                  backgroundColor: 'red',
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 5px rgba(0,0,0,0.5)'
                }} />
              )}
            </div>

            <p style={{ fontSize: '12px', color: normalizedCoords ? 'green' : 'red', marginTop: '10px' }}>
              {normalizedCoords 
                ? `Punto fijado: (${Math.round(normalizedCoords.percentX * 100)}% H, ${Math.round(normalizedCoords.percentY * 100)}% V)` 
                : 'Haz clic sobre el documento para fijar el punto.'}
            </p>

            <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setSelectedDoc(null)} style={{ padding: '6px 12px' }}>Cancelar</button>
              <button 
                onClick={() => handleSignDocument(selectedDoc)} 
                disabled={loading || !normalizedCoords}
                style={{ background: normalizedCoords ? '#16a34a' : '#ccc', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}
              >
                {loading ? 'Procesando...' : 'Estampar Firma'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}