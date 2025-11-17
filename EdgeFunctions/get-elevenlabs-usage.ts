import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
function getUnixTimestamps() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  return {
    start_unix: startOfYear.getTime(),
    end_unix: now.getTime()
  };
}
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    // Get all ElevenLabs API keys from environment
    const apiKeys = [
      Deno.env.get('ELEVENLABS_API_KEY'),
      Deno.env.get('ELEVENLABS_API_KEY_1'),
      Deno.env.get('ELEVENLABS_API_KEY_2'),
      Deno.env.get('ELEVENLABS_API_KEY_3'),
      Deno.env.get('ELEVENLABS_API_KEY_4'),
      Deno.env.get('ELEVENLABS_API_KEY_5'),
      Deno.env.get('ELEVENLABS_API_KEY_6'),
      Deno.env.get('ELEVENLABS_API_KEY_7')
    ].filter((key)=>key !== undefined).map((key, index)=>({
        index,
        key
      }));
    console.log(`Found ${apiKeys.length} ElevenLabs API keys`);
    const { start_unix, end_unix } = getUnixTimestamps();
    // Fetch character stats for each key
    const usagePromises = apiKeys.map(async ({ index, key })=>{
      try {
        const url = new URL('https://api.elevenlabs.io/v1/usage/character-stats');
        url.searchParams.append('start_unix', start_unix.toString());
        url.searchParams.append('end_unix', end_unix.toString());
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'xi-api-key': key
          }
        });
        if (!response.ok) {
          console.error(`Key ${index} error: HTTP ${response.status}`);
          return {
            keyIndex: index,
            status: 'error',
            error: `HTTP ${response.status}`
          };
        }
        const data = await response.json();
        return {
          keyIndex: index,
          status: 'success',
          ...data
        };
      } catch (error) {
        console.error(`Key ${index} error: ${error.message}`);
        return {
          keyIndex: index,
          status: 'error',
          error: error.message
        };
      }
    });
    const results = await Promise.all(usagePromises);
    return new Response(JSON.stringify({
      success: true,
      period: {
        start_unix,
        end_unix
      },
      data: results
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error in get-elevenlabs-usage function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
