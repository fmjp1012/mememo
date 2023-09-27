<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Models\GithubAccount;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens;
    use HasFactory;
    use Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'user_name',
    ];

    public function googleAccount()
    {
        return $this->hasOne(GoogleAccount::class);
    }
    public function githubAccount()
    {
        return $this->hasOne(GithubAccount::class);
    }

    public function cards()
    {
        return $this->hasMany(Card::class);
    }
}
