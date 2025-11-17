import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseServiceKey);
Deno.serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    const { candidateId, interviewId, uploadSessionId, chunkData, chunkIndex, isLastChunk, totalSize } = body;
    console.log(`Processing chunk ${chunkIndex} for session ${uploadSessionId}`);
    // Generate filename
    const fileName = `${interviewId}_${candidateId}_video.webm`;
    // Convert base64 (data URL or raw) to Uint8Array with robust sanitization
    let rawInput = chunkData ?? '';
    let b64 = rawInput.trim();
    // If it's a data URL or contains headers, strip everything up to the last comma
    if (b64.startsWith('data:') || b64.includes(';base64') || b64.includes(',')) {
      const lastComma = b64.lastIndexOf(',');
      if (lastComma !== -1) {
        b64 = b64.slice(lastComma + 1);
      } else {
        // Try explicit base64 markers
        const b64CommaIdx = b64.lastIndexOf('base64,');
        const b64EqualIdx = b64.lastIndexOf('base64=');
        if (b64CommaIdx !== -1) b64 = b64.slice(b64CommaIdx + 7);
        else if (b64EqualIdx !== -1) b64 = b64.slice(b64EqualIdx + 7);
      }
    }
    // Normalize URL-safe base64 variants and remove whitespace
    b64 = b64.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    // If it still looks like a header fragment (e.g., 'opus;base64='), ignore safely
    if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length < 16) {
      console.warn('Ignoring non-base64 or header-only chunk', {
        len: b64.length,
        preview: b64.slice(0, 32)
      });
      b64 = '';
    } else if (b64.length % 4 !== 0) {
      b64 += '='.repeat(4 - b64.length % 4);
    }
    let chunkBytes = new Uint8Array();
    if (b64) {
      try {
        const binary = atob(b64);
        chunkBytes = new Uint8Array(binary.length);
        for(let i = 0; i < binary.length; i++)chunkBytes[i] = binary.charCodeAt(i);
      } catch (e) {
        console.error('Base64 decode failed (ignored chunk)', {
          len: b64.length,
          preview: b64.slice(0, 32)
        });
      // Keep chunkBytes as empty to avoid failing the whole request
      }
    }
    // Check if upload session exists, create if not
    let { data: session, error: sessionError } = await supabase.from('video_upload_sessions').select('*').eq('upload_session_id', uploadSessionId).maybeSingle();
    if (sessionError && sessionError.code !== 'PGRST116') {
      console.error('Error fetching session:', sessionError);
      throw sessionError;
    }
    if (!session) {
      // Create new session
      const { data: newSession, error: createError } = await supabase.from('video_upload_sessions').insert({
        candidate_id: candidateId,
        interview_id: interviewId,
        upload_session_id: uploadSessionId,
        file_name: fileName,
        total_size: totalSize,
        uploaded_size: 0,
        chunk_count: 0,
        status: 'active'
      }).select().single();
      if (createError) {
        console.error('Error creating session:', createError);
        throw createError;
      }
      session = newSession;
    }
    // Check if file exists in storage
    const { data: existingFile } = await supabase.storage.from('video-recordings').list('', {
      search: fileName
    });
    const fileExists = Array.isArray(existingFile) && existingFile.length > 0;
    // Only touch storage when we actually have bytes
    if (chunkBytes.length > 0) {
      if (!fileExists) {
        // Create or upsert the file with the first chunk
        const { error: uploadError } = await supabase.storage.from('video-recordings').upload(fileName, chunkBytes, {
          contentType: 'video/webm',
          upsert: true
        });
        if (uploadError) {
          console.error('Error uploading new file:', uploadError);
          throw uploadError;
        }
      } else {
        // Append to existing file by downloading, concatenating, and re-uploading
        const { data: existingData, error: downloadError } = await supabase.storage.from('video-recordings').download(fileName);
        if (downloadError || !existingData) {
          console.warn('Download failed, falling back to upsert upload:', downloadError);
          const { error: fallbackUploadError } = await supabase.storage.from('video-recordings').upload(fileName, chunkBytes, {
            contentType: 'video/webm',
            upsert: true
          });
          if (fallbackUploadError) {
            console.error('Fallback upload error:', fallbackUploadError);
            throw fallbackUploadError;
          }
        } else {
          // Concatenate existing data with new chunk
          const existingBytes = new Uint8Array(await existingData.arrayBuffer());
          const combinedBytes = new Uint8Array(existingBytes.length + chunkBytes.length);
          combinedBytes.set(existingBytes, 0);
          combinedBytes.set(chunkBytes, existingBytes.length);
          // Re-upload the combined file
          const { error: updateError } = await supabase.storage.from('video-recordings').update(fileName, combinedBytes, {
            contentType: 'video/webm'
          });
          if (updateError) {
            console.error('Error updating file with chunk:', updateError);
            throw updateError;
          }
        }
      }
    }
    // Update session progress
    const newUploadedSize = (session.uploaded_size || 0) + chunkBytes.length;
    const newChunkCount = (session.chunk_count || 0) + 1;
    const { error: updateSessionError } = await supabase.from('video_upload_sessions').update({
      uploaded_size: newUploadedSize,
      chunk_count: newChunkCount,
      status: isLastChunk ? 'completed' : 'active'
    }).eq('upload_session_id', uploadSessionId);
    if (updateSessionError) {
      console.error('Error updating session:', updateSessionError);
      throw updateSessionError;
    }
    // If this is the last chunk, update transcripts table with video URL
    if (isLastChunk) {
      const { data: publicUrl } = supabase.storage.from('video-recordings').getPublicUrl(fileName);
      const { error: transcriptError } = await supabase.from('transcripts').update({
        video_recording_url: publicUrl.publicUrl
      }).eq('candidate_id', candidateId).eq('interview_id', interviewId);
      if (transcriptError) {
        console.error('Error updating transcript with video URL:', transcriptError);
      // Don't throw here - the upload was successful even if transcript update failed
      }
      console.log(`Video upload completed for ${fileName}`);
    }
    return new Response(JSON.stringify({
      success: true,
      uploadedSize: newUploadedSize,
      chunkCount: newChunkCount,
      isCompleted: isLastChunk
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Upload failed',
      details: error
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
