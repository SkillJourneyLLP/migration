import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verify } from 'https://deno.land/x/djwt@v2.8/mod.ts';
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
    // Internal JWT verification
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return new Response(JSON.stringify({
        error: 'Missing authorization token'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const jwtSecret = Deno.env.get('JWT_SECRET');
    if (!jwtSecret) {
      console.error('JWT_SECRET not configured');
      return new Response(JSON.stringify({
        error: 'Server configuration error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(jwtSecret), {
      name: 'HMAC',
      hash: 'SHA-256'
    }, false, [
      'verify'
    ]);
    let payload;
    try {
      payload = await verify(token, key);
    } catch (err) {
      console.error('JWT verification failed:', err);
      return new Response(JSON.stringify({
        error: 'Invalid token'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!payload || !payload.userId) {
      return new Response(JSON.stringify({
        error: 'Invalid token payload'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { action, requestingUserId, candidateId, candidateData, interviewId } = await req.json();
    // Verify token userId matches requestingUserId
    if (payload.userId !== requestingUserId) {
      return new Response(JSON.stringify({
        error: 'Token user mismatch'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!requestingUserId || !action) {
      return new Response(JSON.stringify({
        error: 'requestingUserId and action are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Validate requesting user is primaryadmin
    const { data: reqUser, error: reqErr } = await supabase.from('users').select('id, role, organization_id').eq('id', requestingUserId).maybeSingle();
    if (reqErr) {
      console.error('Error fetching requesting user:', reqErr);
      return new Response(JSON.stringify({
        error: 'Failed to validate requester'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!reqUser || reqUser.role?.toLowerCase() !== 'primaryadmin') {
      return new Response(JSON.stringify({
        error: 'Only primary admins can manage candidates'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const organizationId = reqUser.organization_id;
    // Handle different actions
    switch(action){
      case 'list':
        {
          // Fetch candidates for interviews belonging to the organization
          const { data: interviews, error: intErr } = await supabase.from('interview').select('id').eq('organization_id', organizationId);
          if (intErr) {
            console.error('Error fetching interviews:', intErr);
            return new Response(JSON.stringify({
              error: 'Failed to fetch interviews'
            }), {
              status: 500,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          const interviewIds = (interviews || []).map((i)=>i.id);
          if (interviewIds.length === 0) {
            return new Response(JSON.stringify({
              candidates: []
            }), {
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          const { data: candidates, error: candErr } = await supabase.from('candidate').select('*').in('interview_id', interviewIds).order('created_at', {
            ascending: false
          });
          if (candErr) {
            console.error('Error fetching candidates:', candErr);
            return new Response(JSON.stringify({
              error: 'Failed to fetch candidates'
            }), {
              status: 500,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          return new Response(JSON.stringify({
            candidates: candidates || []
          }), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
      case 'delete':
        {
          if (!candidateId) {
            return new Response(JSON.stringify({
              error: 'candidateId is required for delete'
            }), {
              status: 400,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          // Verify candidate belongs to organization's interview
          const { data: candidate, error: candErr } = await supabase.from('candidate').select('interview_id').eq('id', candidateId).maybeSingle();
          if (candErr || !candidate) {
            console.error('Error fetching candidate:', candErr);
            return new Response(JSON.stringify({
              error: 'Candidate not found'
            }), {
              status: 404,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          const { data: interview, error: intErr } = await supabase.from('interview').select('organization_id').eq('id', candidate.interview_id).maybeSingle();
          if (intErr || !interview || interview.organization_id !== organizationId) {
            return new Response(JSON.stringify({
              error: 'Unauthorized'
            }), {
              status: 403,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          const { error: deleteErr } = await supabase.from('candidate').delete().eq('id', candidateId);
          if (deleteErr) {
            console.error('Error deleting candidate:', deleteErr);
            return new Response(JSON.stringify({
              error: 'Failed to delete candidate'
            }), {
              status: 500,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          return new Response(JSON.stringify({
            success: true
          }), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
      case 'update':
        {
          if (!candidateId || !candidateData) {
            return new Response(JSON.stringify({
              error: 'candidateId and candidateData are required for update'
            }), {
              status: 400,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          // Verify candidate belongs to organization's interview
          const { data: candidate, error: candErr } = await supabase.from('candidate').select('interview_id').eq('id', candidateId).maybeSingle();
          if (candErr || !candidate) {
            console.error('Error fetching candidate:', candErr);
            return new Response(JSON.stringify({
              error: 'Candidate not found'
            }), {
              status: 404,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          const { data: interview, error: intErr } = await supabase.from('interview').select('organization_id').eq('id', candidate.interview_id).maybeSingle();
          if (intErr || !interview || interview.organization_id !== organizationId) {
            return new Response(JSON.stringify({
              error: 'Unauthorized'
            }), {
              status: 403,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          const { error: updateErr } = await supabase.from('candidate').update(candidateData).eq('id', candidateId);
          if (updateErr) {
            console.error('Error updating candidate:', updateErr);
            return new Response(JSON.stringify({
              error: 'Failed to update candidate'
            }), {
              status: 500,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          return new Response(JSON.stringify({
            success: true
          }), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
      case 'add':
        {
          if (!candidateData || !interviewId) {
            return new Response(JSON.stringify({
              error: 'candidateData and interviewId are required for add'
            }), {
              status: 400,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          // Verify interview belongs to organization
          const { data: interview, error: intErr } = await supabase.from('interview').select('organization_id').eq('id', interviewId).maybeSingle();
          if (intErr || !interview || interview.organization_id !== organizationId) {
            return new Response(JSON.stringify({
              error: 'Unauthorized'
            }), {
              status: 403,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          const { data: newCandidate, error: addErr } = await supabase.from('candidate').insert({
            ...candidateData,
            interview_id: interviewId
          }).select().single();
          if (addErr) {
            console.error('Error adding candidate:', addErr);
            return new Response(JSON.stringify({
              error: 'Failed to add candidate'
            }), {
              status: 500,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }
          return new Response(JSON.stringify({
            candidate: newCandidate
          }), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
      default:
        return new Response(JSON.stringify({
          error: 'Invalid action'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
    }
  } catch (error) {
    console.error('manage-candidates error:', error);
    return new Response(JSON.stringify({
      error: error.message ?? 'Unexpected error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
