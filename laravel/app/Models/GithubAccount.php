<?php

namespace App\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class GithubAccount extends Model
{
    use HasFactory;

    protected $fillable = [
        'github_id',
        'user_id',
        'github_name',
        'email',
        'avatar',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
