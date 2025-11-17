import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { organizationId } = await req.json();
    if (!organizationId) {
      return new Response(JSON.stringify({
        error: 'Organization ID is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Get all users with roles in this organization
    const { data: roleData, error: roleError } = await supabase.from('user_roles').select(`
        id,
        role,
        created_at,
        user_id,
        users!inner (
          email
        )
      `).eq('organization_id', organizationId).order('created_at', {
      ascending: false
    });
    if (roleError) {
      console.error('Error fetching admins:', roleError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch admins'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const admins = roleData.map((item)=>({
        id: item.user_id,
        email: item.users.email,
        role: item.role,
        created_at: item.created_at
      }));
    return new Response(JSON.stringify({
      admins
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
