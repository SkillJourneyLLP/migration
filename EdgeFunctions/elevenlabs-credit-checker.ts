import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log('Starting credit check for all ElevenLabs keys');
    // Get all active keys
    const { data: keys, error: keysError } = await supabase.from('elevenlabs_key_usage').select('*').eq('is_active', true);
    if (keysError) {
      console.error('Error fetching keys:', keysError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch keys'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const updatedKeys = [];
    const now = new Date();
    for (const key of keys){
      try {
        // Check if we need to update credits (only if last check was > 5 minutes ago)
        const lastCheck = key.last_credit_check ? new Date(key.last_credit_check) : null;
        const shouldCheckCredits = !lastCheck || now.getTime() - lastCheck.getTime() > 5 * 60 * 1000;
        if (!shouldCheckCredits) {
          console.log(`Skipping credit check for key ${key.key_index} - checked recently`);
          updatedKeys.push({
            keyIndex: key.key_index,
            availableCredits: key.available_credits,
            lastChecked: key.last_credit_check,
            skipped: true
          });
          continue;
        }
        // Get the API key from environment
        const apiKey = Deno.env.get(`ELEVENLABS_API_KEY_${key.key_index}`);
        if (!apiKey) {
          console.error(`API key not found for index ${key.key_index}`);
          continue;
        }
        // Call ElevenLabs API to get subscription info
        const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
          method: 'GET',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) {
          console.error(`ElevenLabs API error for key ${key.key_index}:`, response.status);
          continue;
        }
        const subscriptionData = await response.json();
        const availableCredits = subscriptionData.character_limit - subscriptionData.character_count;
        console.log(`Key ${key.key_index}: ${availableCredits} credits available`);
        // Update the database with new credit info
        const { error: updateError } = await supabase.from('elevenlabs_key_usage').update({
          available_credits: availableCredits,
          last_credit_check: now.toISOString(),
          updated_at: now.toISOString()
        }).eq('key_index', key.key_index);
        if (updateError) {
          console.error(`Error updating credits for key ${key.key_index}:`, updateError);
          continue;
        }
        updatedKeys.push({
          keyIndex: key.key_index,
          availableCredits: availableCredits,
          lastChecked: now.toISOString(),
          belowThreshold: availableCredits < (key.credit_threshold || 4000)
        });
      } catch (error) {
        console.error(`Error checking credits for key ${key.key_index}:`, error);
      }
    }
    console.log(`Credit check completed. Updated ${updatedKeys.length} keys`);
    return new Response(JSON.stringify({
      success: true,
      updatedKeys: updatedKeys,
      totalKeys: keys.length,
      timestamp: now.toISOString()
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in credit checker:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
